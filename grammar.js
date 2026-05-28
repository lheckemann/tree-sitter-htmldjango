function tag($, name, args = undefined) {
  return seq(
      "{%", field("tag_name", name),
      ...(args ? [args($)] : []),
      "%}",
  )
}
const BLOCKS = [
  {name: "autoescape", args: $ => choice("on", "off")},
  {
    name: "block",
    args: $ => field("block_name", $.identifier),
    end_args: $ => optional(field("block_name", $.identifier))
  },
  {name: "ifchanged", args: $ => repeat($.expression)},
  {name: "spaceless", args: $ => repeat($.expression)},
  {name: "with", args: $ => repeat($.binding)},
  {name: "filter", args: $ => seq($.filter, repeat(seq("|", $.filter)))},
]
const TAGS = [
  {name: "if", args: $ => repeat($.expression)},
  {name: "elif", args: $ => repeat($.expression)},
  {name: "else"},
  {name: "endif"},
  {
    name: "for",
    args: $ => seq(
      field("loop_variable", seq($.identifier, optional(repeat(seq(",", $.identifier))))),
      "in",
      $.expression
    )
  },
  {name: "empty"},
  {name: "endfor"},
  {name: "verbatim", args: $ => optional($.identifier)},
  {name: "endverbatim", args: $ => optional($.identifier)},
  {name: "comment", args: $ => optional($.identifier)},
  {name: "endcomment"},
  {name: "blocktrans", args: $ => repeat($._blocktranslate_arg)},
  {name: "blocktranslate", args: $ => repeat($._blocktranslate_arg)},
  {name: "endblocktrans"},
  {name: "endblocktranslate"},
  {name: "plural"},
  {name: "include", args: $ => seq(
    choice($.string, $.identifier, $.attribute_path),
    optional(seq("with", repeat1($.binding), optional("only"))),
  )},
  {name: "extends", args: $ => choice($.string, $.identifier)},
  {name: "cycle", args: $ =>
      seq(
        repeat1($.expression),
        optional(seq("as", $.identifier)),
        optional("silent"),
      ),
  },
  {name: "load", args: $ =>
      choice(
        repeat1(choice($.identifier, $.attribute_path)),
        seq(repeat1($.identifier), "from", $.attribute_path),
      ),
  },
  {name: "regroup", args: $ => seq(
    field("group", $.expression),
    "by",
    field("grouping_criterion", $.identifier),
    $.tag_binding
  )},
  {name: "trans", args: $ => seq(field("msgid", $.string), optional($._filter_chain), repeat($._translate_arg))},
  {name: "translate", args: $ => seq(field("msgid", $.string), optional($._filter_chain), repeat($._translate_arg))},
  ...BLOCKS,
  ...(BLOCKS.map(({name, end_args}) => ({name: `end${name}`, args: end_args}))),
]


const TAG_RULES = Object.fromEntries([
  ...(TAGS.map(({name, args}) => [`__${name}_tag`, $ => tag($, name, args)])),
  ...(TAGS.map(({name}) =>  [`_${name}_tag`, $ => alias($[`__${name}_tag`], $.tag)])),
])

const BLOCK_RULES = Object.fromEntries([
  ...BLOCKS.map(
    ({name}) => [
      `__${name}_block`,
      $ => seq(
        field("start_tag", $[`_${name}_tag`]),
        alias(repeat($._node), $.block_body),
        field("end_tag", $[`_end${name}_tag`]),
      ),
    ]
  ),
  ...(BLOCKS.map(({name}) =>  [`_${name}_block`, $ => alias($[`__${name}_block`], $.block)])),
])
module.exports = grammar({
  name: "htmldjango",

  word: $ => $.identifier,

  conflicts: $ => [
    // elif tag can't be told apart from other tags in an if block without looking ahead
    [$._elif_block],
    // `{% load a from b %}` can't be told apart from `{% load a b c %}` without looking ahead
    [$.__load_tag],
  ],

  rules: {
    template: $ => repeat(
      $._node
    ),

    _node: $ => choice(
      $.variable,
      $._statement,
      $._comment,
      $.content
    ),

    variable: $ => seq("{{", $.expression, "}}"),

    // Expression "language"; django's template engine plays very fast-and-loose
    // with these, so we need to be lenient...
    special_identifier: $ => token(seq(
      choice(
        "on",
        "off",
        "silent",
        "from",
        "if",
      ),
      /\s/
    )),
    keyword_operator: $ => token(seq(
      choice(
        "and",
        "or",
        "not",
        "in",
        "not in",
        "is",
        "is not"
      ),
      /\s/
    )),
    operator: $ => choice("==", "!=", "<", ">", "<=", ">="),
    number: $ => /[0-9]+/,
    boolean: $ => token(seq(choice("True", "False"), /\s/)),
    string: $ => choice(
      seq("'", repeat(/[^']|\\'/), "'"),
      seq('"', repeat(/[^"]|\\"/), '"')
    ),

    identifier: $ => /[\w_-]+/,
    attribute_path: $ => seq($.identifier, repeat1(seq(".", $.identifier))),

    filter: $ => seq(
      field("filter_name", $.identifier),
      optional(seq(":", $.filter_argument))
    ),
    filter_argument: $ => choice(
      $.identifier,
      $.attribute_path,
      $.string,
      $.translated_string,
    ),

    _filter_chain: $ => repeat1(seq("|", $.filter)),
    _atom: $ => choice(
      $.special_identifier,
      $.attribute_path,
      $.identifier,
      $.number,
      $.boolean,
      $.string,
    ),
    _filtered_atom: $ => seq($._atom, optional($._filter_chain)),
    translated_string: $ => seq("_", "(", $.string, ")"),
    expression: $ => choice(
      $._filtered_atom,
      seq($._filtered_atom, $.operator, $.expression),
      $.translated_string,
    ),

    // Statements
    // unpaired type {% tag %}
    // 
    // paired type   {% tag %}..{% endtag %}
    _statement: $ => choice(
      $._known_block,
      $._known_tag,
      alias($._unrecognised_tag, $.tag),
    ),

    _known_tag: $ => choice(
      $._cycle_tag,
      $._include_tag,
      $._extends_tag,
      $._load_tag,
      $._regroup_tag,
      $._trans_tag,
      $._translate_tag,
    ),

    _known_block: $ => choice(
      alias($.if_block, $.block),
      alias($._for_block, $.block),
      alias($._verbatim_block, $.block),
      alias($._blocktranslate_block, $.block),
      ...(BLOCKS.map(({name}) => $[`_${name}_block`])),
    ),

    _elif_block: $ => seq(
        field("elif_tag", $._elif_tag),
        alias(repeat($._node), $.block_body),
    ),

    if_block: $ => seq(
      field("if_tag", $._if_tag),
      alias(repeat($._node), $.block_body),
      repeat($._elif_block),
      optional(seq(
        field("else_tag", $._else_tag),
        alias(repeat($._node), $.block_body),
      )),
      field("endif_tag", $._endif_tag),
    ),

    _for_block: $ => seq(
      $._for_tag,
      alias(repeat($._node), $.block_body),
      optional(seq(
        $._empty_tag,
        field("empty_body", alias(repeat($._node), $.block_body)),
      )),
      $._endfor_tag,
    ),

    _filter_block: $ => seq(
      $._filter_tag,
      repeat($._node),
      $._endfilter_tag,
    ),

    _verbatim_block: $ => seq(
      $._verbatim_tag,
      alias(repeat(/[^{]+|\{[^%]/), $.verbatim_content),
      $._endverbatim_tag,
    ),

    _blocktranslate_block: $ => seq(
      field("start_tag", choice($._blocktranslate_tag, $._blocktrans_tag)),
      alias(repeat($._node), $.block_body),
      optional(seq(
        $._plural_tag,
        alias(repeat($._node), $.block_body),
      )),
      field("end_tag", choice($._endblocktranslate_tag, $._endblocktrans_tag)),
    ),

    _blocktranslate_arg: $ => choice(
      $._with_bindings,
      seq("count", field("count", choice(field("binding", $.binding), $.expression))),
      seq("context", field("context", $.string)),
      alias(seq("asvar", field("bound_name", $.identifier)), $.tag_binding),
      field("trimmed", "trimmed"),
    ),
    _translate_arg: $ => choice(
      $.tag_binding,
      seq("context", field("context", $.string)),
    ),

    _equals_binding: $ => seq(field("name", $.identifier), "=", field("value", $.expression)),
    binding: $ => choice(
      seq(field("value", $.expression), "as", field("name", $.identifier)),
      $._equals_binding
    ),

    _with_bindings: $ => seq(
      "with",
      field("binding", $.binding),
      optional(seq(
        optional(choice("and", ",")),
        field("binding", $.binding),
      ))
    ),

    tag_binding: $ => seq("as", field("bound_name", $.identifier)),

    _unrecognised_tag: $ => seq(
      "{%",
      // nasty hack to avoid matching elif; not sure if there's a better way to
      // ensure that ifs are parsed correctly
      field("tag_name", /([^e\s]|e[^l]|el[^i]|eli[^f])\w*/),
      repeat(choice(
        $.expression,
        alias($._equals_binding, $.binding),
        $.tag_binding,
        /\{[^%]+/,
      )),
      "%}",
    ),

    // Comments
    // unpaired type {# comment #}
    // paired type   {% comment optional_label %}..{% endcomment %}
    _comment: $ => choice(
      $.unpaired_comment,
      $.paired_comment
    ),
    unpaired_comment: $ => seq("{#", repeat(/.|\s/), repeat(seq(alias($.unpaired_comment, ""), repeat(/.|\s/))), "#}"),
    paired_comment: $ => seq(
      field("start_tag", $._comment_tag),
      repeat(/.|\s/),
      repeat(seq($.paired_comment, repeat(/.|\s/))),
      field("end_tag", $._endcomment_tag),
    ),

    // All other content
    content: $ => /([^\{]|\{[^{%#])+/,

    ...TAG_RULES,
    ...BLOCK_RULES,
  }
});
