/*
 * Copyright (c) 2014 Nick Matantsev
 * Licensed under the BSD license.
 */

'use strict';

var parse = require('css-parse');

function isSelectorGlobal(v) {
    if (v.charAt(0) === '@') {
        return true;
    }

    // test for simple tag name/star with possible attached pseudo- or attribute selectors
    return /^([a-z0-9]+|\*)(::?[a-z-]+|\[[^\]]+\])*$/.test(v);
}

function walkChildSelectors(callback, remainder, isParentConstrained) {
    var isConstrained = false;

    // @todo prevent sibling selector on top class
    if (remainder.charAt(0) === '>') {
        isConstrained = true;
        remainder = remainder.replace(/^\>\s+/, '');
    } else if (remainder.charAt(0) === '+') {
        isConstrained = isParentConstrained; // we are constrained if parent is constrained
        remainder = remainder.replace(/^\+\s+/, '');
    }

    // match optional tag name and a class that does not start with dash (i.e. BEM modifier)
    var childMatch = /^([a-z0-9-]+|\*)?(?:\.((?=[^-])[a-z0-9_-]+))?(.*)$/.exec(remainder);

    var childElement = childMatch[1],
        childClass = childMatch[2],
        trailer = childMatch[3];

    var continueParsing = callback(childElement, childClass, isConstrained);

    while(/^\S/.test(trailer)) {
        var modifierMatch = /^(?:\.-[a-z0-9-]+|::?[a-z-]+|\[[^\]]+\])(.*)$/.exec(trailer);

        if (!modifierMatch) {
            throw new Error('invalid modifier: "' + trailer + '"');
        }

        trailer = modifierMatch[1];
    };

    if (continueParsing && trailer !== '') {
        walkChildSelectors(callback, trailer.replace(/^\s+/, ''), isConstrained);
    }
}

function findNextRule(ruleList, startIndex) {
    while (ruleList.length > startIndex) {
        if (ruleList[startIndex].type === 'rule') {
            return ruleList[startIndex];
        }

        startIndex += 1;
    }

    throw new Error('no rules left');
}

function checkCSS(css, report) {
    var ast = parse(css, { position: true }),
        ignoreSelectors = null;

    function isSelectorIgnored(v) {
        if (ignoreSelectors === null) {
            return false;
        }

        return ignoreSelectors.some(function (prefix) {
            // make sure prefix matches but the first following character is not a word
            return v.substring(0, prefix.length) === prefix && !/^[a-z0-9_-]/.test(v.substring(prefix.length));
        });
    }

    ast.stylesheet.rules.forEach(function (rule, ruleIndex) {
        if (rule.type === 'comment' && /^\s*airtight\s+ignore\s*$/.test(rule.comment)) {
            ignoreSelectors = findNextRule(ast.stylesheet.rules, ruleIndex + 1).selectors;
            return;
        }

        if (rule.type !== 'rule') {
            return;
        }

        var positionStart = rule.position.start;

        function fullReport(msg) {
            report(positionStart.line, positionStart.column, msg);
        }

        rule.selectors.forEach(function (v) {
            // see if we are ignoring this rule selector
            if (isSelectorIgnored(v)) {
                return;
            }

            if (isSelectorGlobal(v)) {
                return;
            }

            // match optional tag with non-dash-prefixed class and following BEM modifiers, pseudo-classes, attributes
            var match = /^([a-z0-9]+)?\.((?=[^-])[a-z0-9-]+)(?:\.-[a-z0-9-]+|::?[a-z-]+|\[[^\]]+\])*(?:\s+(.*))?$/.exec(v);

            if (!match) {
                fullReport('cannot recognize top-level selector match');
                return;
            }

            var topElement = match[1],
                topClass = match[2],
                childElements = match[3];

            if (topElement) {
                fullReport('do not use top-level tag match: "' + topElement + '"');
            }

            if (childElements === undefined) {
                return;
            }

            var fullBEMPrefix = topClass + '__';

            walkChildSelectors(function (childElement, childClass, isParentConstrained) {
                if (childClass && !childElement) {
                    if (childClass.charAt(0) !== '_' && childClass.substring(0, fullBEMPrefix.length) !== fullBEMPrefix) {
                        fullReport('child class must have BEM prefix: ".' + childClass + '"');
                    }
                } else if (childElement && !childClass) {
                    if (!isConstrained) {
                        fullReport('tag-based match must be a direct child or sibling of direct child: "' + remainder + '"');
                    }

                    if (childElement === 'div' || childElement === 'span') {
                        fullReport('do not use non-semantic tag name: "' + childElement + '"');
                    }
                } else {
                    fullReport('must specify either child element or class but not both: "' + remainder + '"');
                }

                return true;
            }, childElements);
        });
    });
}

module.exports = checkCSS;
