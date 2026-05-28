module.exports = grammar({
  name: "htmldjango",

  word: $ => $.identifier,

  conflicts: $ => [
    // elif tag can't be told apart from other tags in an if block without looking ahead
    [$._if_block],
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
      $._general_expression_tag,
      $._load_tag,
      $._regroup_tag,
    ),

    _known_block: $ => choice(
      $._if_block,
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
        "{%", alias(tag_name, $.tag_name), repeat($.expression), "%}",
        repeat($._node),
        "{%", alias("end" + tag_name, $.tag_name), repeat($.expression), "%}")));
    },

    _if_tag: $ => seq("{%", alias("if", $.tag_name), repeat($.expression), "%}"),
    _elif_tag: $ => seq("{%", alias("elif", $.tag_name), repeat($.expression), "%}"),
    _else_tag: $ => seq("{%", alias("else", $.tag_name), "%}"),
    _endif_tag: $ => seq("{%", alias("endif", $.tag_name), "%}"),

    _if_block: $ => seq(
      $._if_tag,
      alias(repeat($._node), $.if_body),
      repeat((seq(
        $._elif_tag,
        alias(repeat1($._node), $.elif_body),
      ))),
      optional(seq(
        $._else_tag,
        alias(repeat1($._node), $.else_body),
      )),
      $._endif_tag,
    ),

    _for_tag: $ => seq("{%", alias("for", $.tag_name), repeat($.expression), "%}"),
    _empty_tag: $ => seq("{%", alias("empty", $.tag_name), repeat($.expression), "%}"),
    _endfor_tag: $ => seq("{%", alias("endfor", $.tag_name), "%}"),
    _for_block: $ => seq(
      $._for_tag,
      alias(repeat($._node), $.for_body),
      optional(seq(
        alias($._empty_tag, $.branch_statement),
        alias(repeat($._node), $.for_empty_body),
      )),
      $._endfor_tag,
    ),

    _filter_block: $ => seq(
      "{%", alias("filter", $.tag_name), $.filter, repeat(seq("|", $.filter)), "%}",
      repeat($._node),
      "{%", alias("endfilter", $.tag_name), "%}"
    ),

    _verbatim_tag: $ => seq("{%", alias("verbatim", $.tag_name), "%}"),
    _endverbatim_tag: $ => seq("{%", alias("endverbatim", $.tag_name), "%}"),
    _verbatim_block: $ => seq(
      $._verbatim_tag,
      alias(repeat(/[^{]+|\{[^%]/), $.verbatim_content),
      $._endverbatim_tag,
    ),

    _include_tag: $ => seq(
      "{%",
      alias("include", $.tag_name),
      choice($.string_literal, $.identifier),
      optional(seq("with", repeat($.binding), optional("only"))),
      "%}"
    ),
    _extends_tag: $ => seq("{%", alias("extends", $.tag_name), choice($.string_literal, $.identifier), "%}"),


    _general_expression_tag: $ => seq(
      "{%",
      alias(choice("firstof"), $.tag_name),
      repeat($.expression),
      "%}",
    ),

    _cycle_tag: $ => seq(
      "{%",
      alias("cycle", $.tag_name),
      repeat1($.expression),
      optional(seq("as", $.identifier)),
      optional("silent"),
      "%}"
    ),

    _load_tag: $ => seq(
      "{%",
      alias("load", $.tag_name),
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
      alias("regroup", $.tag_name),
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
      alias($.identifier, $.tag_name),
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
