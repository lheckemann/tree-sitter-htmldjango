module.exports = grammar({
  name: "htmldjango",

  word: $ => $.identifier,

  conflicts: $ => [[$.if_block]],

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

    // General rules
    keyword: $ => token(seq(
      choice(
        "on",
        "off",
        "with",
        "as",
        "silent",
        "only",
        "from",
        "random",
        "by"
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
    string_literal: $ => seq(
      choice(
        seq("'", repeat(/[^']|\\'/), "'"),
        seq('"', repeat(/[^"]|\\"/), '"')
      ),
      repeat(seq("|", $.filter))
    ),

    identifier: $ => /\w+/,

    // Variables
    variable: $ => seq("{{", choice($.expression, $.string_literal), "}}"),

    expression: $ => choice(
      seq($.variable_name, repeat(seq("|", $.filter))),
      seq("_", "(", $.string_literal, ")"),
    ),
    // Django variables cannot start with an "_", can contain one or more words separated by a "."
    variable_name: $ => /[a-zA-Z]([\w-]+)?((\.?[\w-])+)?/,

    filter: $ => seq($.filter_name, optional(seq(":", choice($.filter_argument, $._quoted_filter_argument)))),
    filter_name: $ => $.identifier,
    filter_argument: $ => seq($.identifier, repeat(seq(".", $.identifier))),
    _quoted_filter_argument: $ => choice(
      seq("'", alias(repeat(/[^']/), $.filter_argument), "'"),
      seq('"', alias(repeat(/[^"]/), $.filter_argument), '"')
    ),

    // Statements
    // unpaired type {% tag %}
    // paired type   {% tag %}..{% endtag %}
    _statement: $ => choice(
      $.block,
      $.if_block,
      $.for_block,
      $.verbatim_block,
      $.filter_statement,
      $.unpaired_statement
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
        "{%", alias(tag_name, $.tag_name), repeat($._attribute), "%}",
        repeat($._node),
        "{%", alias("end" + tag_name, $.tag_name), repeat($._attribute), "%}")));
    },

    if_tag: $ => seq("{%", alias("if", $.tag_name), repeat($._attribute), "%}"),
    elif_tag: $ => seq("{%", alias("elif", $.tag_name), repeat($._attribute), "%}"),
    else_tag: $ => seq("{%", alias("else", $.tag_name), "%}"),
    endif_tag: $ => seq("{%", alias("endif", $.tag_name), "%}"),

    if_block: $ => seq(
      $.if_tag,
      alias(repeat($._node), $.if_body),
      repeat((seq(
        $.elif_tag,
        alias(repeat1($._node), $.elif_body),
      ))),
      optional(seq(
        $.else_tag,
        alias(repeat1($._node), $.else_body),
      )),
      $.endif_tag,
    ),

    for_tag: $ => seq("{%", alias("for", $.tag_name), repeat($._attribute), "%}"),
    empty_tag: $ => seq("{%", alias("empty", $.tag_name), repeat($._attribute), "%}"),
    endfor_tag: $ => seq("{%", alias("endfor", $.tag_name), "%}"),
    for_block: $ => seq(
      $.for_tag,
      alias(repeat($._node), $.for_body),
      optional(seq(
        alias($.empty_tag, $.branch_statement),
        alias(repeat($._node), $.for_empty_body),
      )),
      $.endfor_tag,
    ),

    filter_statement: $ => seq(
      "{%", alias("filter", $.tag_name), $.filter, repeat(seq("|", $.filter)), "%}",
      repeat($._node),
      "{%", alias("endfilter", $.tag_name), alias("%}", $.end_paired_statement)
    ),
    unpaired_statement: $ => seq("{%", alias($.identifier, $.tag_name), repeat($._attribute), "%}"),

    verbatim_tag: $ => seq("{%", alias("verbatim", $.tag_name), "%}"),
    endverbatim_tag: $ => seq("{%", alias("endverbatim", $.tag_name), "%}"),
    verbatim_block: $ => seq(
      $.verbatim_tag,
      alias(repeat(/[^{]+|\{[^%]/), $.verbatim_content),
      $.endverbatim_tag,
    ),

    _attribute: $ => seq(
      choice(
        $.keyword,
        $.operator,
        $.keyword_operator,
        $.number,
        $.boolean,
        $.string_literal,
        $.expression
      ),
      optional(choice(",", "="))
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
      alias("{%", ""), "comment", optional($.identifier), alias("%}", ""),
      repeat(/.|\s/),
      repeat(seq(alias($.paired_comment, ""), repeat(/.|\s/))),
      alias("{%", ""), "endcomment", alias("%}", "")
    ),

    // All other content
    content: $ => /([^\{]|\{[^{%#])+/
  }
});
