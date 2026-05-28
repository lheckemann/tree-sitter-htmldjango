module.exports = grammar({
  name: "htmldjango",

  word: $ => $.identifier,

  reserved: {
    "default": $ => ["if", "elif", "else"],
  },


  conflicts: $ => [
    // elif tag can't be told apart from other tags in an if block without looking ahead
    // [$.if_block],
    // `{% load a from b %}` can't be told apart from `{% load a b c %}` without looking ahead
    [$._load_tag],
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
    string_literal: $ => choice(
      seq("'", repeat(/[^']|\\'/), "'"),
      seq('"', repeat(/[^"]|\\"/), '"')
    ),

    identifier: $ => /\w+/,
    attribute_path: $ => seq($.identifier, repeat1(seq(".", $.identifier))),

    filter: $ => seq(
      "|",
      alias($.identifier, $.filter_name),
      optional(seq(":", $.filter_argument))
    ),
    filter_argument: $ => choice($.identifier, $.attribute_path, $.string_literal),

    expression: $ => seq(
      choice(
        $.special_identifier,
        $.attribute_path,
        $.identifier,
        $.number,
        $.boolean,
        $.string_literal,
      ),
      repeat($.filter)
    ),

    // Statements
    // unpaired type {% tag %}
    // paired type   {% tag %}..{% endtag %}
    _statement: $ => choice(
      $._known_block,
      alias($._known_tag, $.tag),
      alias($._unrecognised_tag, $.tag),
    ),

    _known_tag: $ => choice(
      $._cycle_tag,
      $._include_tag,
      $._extends_tag,
      $._load_tag,
      $._regroup_tag,
    ),

    _known_block: $ => choice(
      $.if_block,
      $._for_block,
      $._filter_block,
      $._verbatim_block,
      $._filter_block,
      $.block,
    ),

    block: $ => {
      const tag_names = [
        "autoescape",
        "block",
        "blocktrans",
        "blocktranslate",
        "ifchanged",
        "spaceless",
        "with"
      ];

      return choice(...tag_names.map((tag_name) => seq(
        "{%", field("tag_name", tag_name), repeat($.expression), "%}",
        alias(repeat($._node), $.block_body),
        "{%", field("tag_name", "end" + tag_name), repeat($.expression), "%}")));
    },

    _if_tag: $ => seq("{%", field("tag_name", "if"), repeat($.expression), "%}"),
    _elif_tag: $ => seq("{%", field("tag_name", "elif"), repeat($.expression), "%}"),
    _else_tag: $ => seq("{%", field("tag_name", "else"), "%}"),
    _endif_tag: $ => seq(token(seq("{%", field("tag_name", "endif"))), "%}"),

    if_block: $ => seq(
      field("if_tag", alias($._if_tag, $.tag)),
      alias(repeat($._node), $.block_body),
      repeat(seq(
        alias($._elif_tag, $.tag),
        alias(repeat(choice($.variable, $._known_tag, $._known_block, $.content)), $.block_body),
      )),
      optional(seq(
        field("else_tag", alias($._else_tag, $.tag)),
        alias(repeat($._node), $.block_body),
      )),
      field("endif_tag", alias($._endif_tag, $.tag)),
    ),

    _for_tag: $ => seq("{%", field("tag_name", "for"), repeat($.expression), "%}"),
    _empty_tag: $ => seq("{%", field("tag_name", "empty"), repeat($.expression), "%}"),
    _endfor_tag: $ => seq("{%", field("tag_name", "endfor"), "%}"),
    _for_block: $ => seq(
      alias($._for_tag, $.tag),
      alias(repeat($._node), $.for_body),
      optional(seq(
        alias($._empty_tag, $.tag),
        alias(repeat($._node), $.for_empty_body),
      )),
      alias($._endfor_tag, $.tag),
    ),

    _filter_block: $ => seq(
      "{%", field("tag_name", "filter"), $.filter, repeat(seq("|", $.filter)), "%}",
      repeat($._node),
      "{%", field("tag_name", "endfilter"), "%}"
    ),

    _verbatim_tag: $ => seq("{%", field("tag_name", "verbatim"), "%}"),
    _endverbatim_tag: $ => seq("{%", field("tag_name", "endverbatim"), "%}"),
    _verbatim_block: $ => seq(
      $._verbatim_tag,
      alias(repeat(/[^{]+|\{[^%]/), $.verbatim_content),
      $._endverbatim_tag,
    ),

    _include_tag: $ => seq(
      "{%",
      field("tag_name", "include"),
      choice($.string_literal, $.identifier),
      optional(seq("with", repeat($.binding), optional("only"))),
      "%}"
    ),
    _extends_tag: $ => seq("{%", field("tag_name", "extends"), choice($.string_literal, $.identifier), "%}"),


    _cycle_tag: $ => seq(
      "{%",
      field("tag_name", "cycle"),
      repeat1($.expression),
      optional(seq("as", $.identifier)),
      optional("silent"),
      "%}"
    ),

    _load_tag: $ => seq(
      "{%",
      field("tag_name", "load"),
      choice(
        repeat1(choice($.identifier, $.attribute_path)),
        seq(repeat1($.identifier), "from", $.attribute_path),
      ),
      "%}"
    ),

    binding: $ => choice(
      seq($.expression, "as", $.identifier),
      seq($.identifier, "=", $.expression),
    ),

    _with_bindings: $ => seq("with", repeat1($.binding)),

    _regroup_tag: $ => seq(
      "{%",
      field("tag_name", "regroup"),
      $.expression,
      "by",
      $.identifier,
      "as",
      $.identifier,
      "%}",
    ),

    tag_binding: $ => seq("as", $.identifier),

    _unrecognised_tag: $ => seq(
      "{%",
      field("tag_name", alias($.identifier, "")),
      repeat(choice(
        $.expression,
        /\{[^%]+/
      )),
      optional($.tag_binding),
      "%}"
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
      "{%", "comment", optional($.identifier), "%}",
      repeat(/.|\s/),
      repeat(seq($.paired_comment, repeat(/.|\s/))),
      "{%", "endcomment", "%}",
    ),

    // All other content
    content: $ => /([^\{]|\{[^{%#])+/
  }
});
