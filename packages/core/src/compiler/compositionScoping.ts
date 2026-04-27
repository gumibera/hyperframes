function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function escapeCssAttributeValue(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function findNextCssToken(css: string, start: number, token: "{" | ";"): number {
  let quote: string | null = null;
  let inComment = false;
  for (let i = start; i < css.length; i++) {
    const char = css[i];
    const next = css[i + 1];
    if (inComment) {
      if (char === "*" && next === "/") {
        inComment = false;
        i++;
      }
      continue;
    }
    if (quote) {
      if (char === "\\") {
        i++;
      } else if (char === quote) {
        quote = null;
      }
      continue;
    }
    if (char === "/" && next === "*") {
      inComment = true;
      i++;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if (char === token) return i;
  }
  return -1;
}

function findMatchingCssBrace(css: string, openIndex: number): number {
  let depth = 0;
  let quote: string | null = null;
  let inComment = false;
  for (let i = openIndex; i < css.length; i++) {
    const char = css[i];
    const next = css[i + 1];
    if (inComment) {
      if (char === "*" && next === "/") {
        inComment = false;
        i++;
      }
      continue;
    }
    if (quote) {
      if (char === "\\") {
        i++;
      } else if (char === quote) {
        quote = null;
      }
      continue;
    }
    if (char === "/" && next === "*") {
      inComment = true;
      i++;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if (char === "{") {
      depth++;
    } else if (char === "}") {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

function splitSelectorList(selectorText: string): string[] {
  const selectors: string[] = [];
  let current = "";
  let quote: string | null = null;
  let inComment = false;
  let bracketDepth = 0;
  let parenDepth = 0;
  for (let i = 0; i < selectorText.length; i++) {
    const char = selectorText[i];
    const next = selectorText[i + 1];
    if (inComment) {
      current += char;
      if (char === "*" && next === "/") {
        current += next;
        inComment = false;
        i++;
      }
      continue;
    }
    if (quote) {
      current += char;
      if (char === "\\") {
        current += next ?? "";
        i++;
      } else if (char === quote) {
        quote = null;
      }
      continue;
    }
    if (char === "/" && next === "*") {
      current += char + next;
      inComment = true;
      i++;
      continue;
    }
    if (char === '"' || char === "'") {
      current += char;
      quote = char;
      continue;
    }
    if (char === "[") bracketDepth++;
    if (char === "]") bracketDepth = Math.max(0, bracketDepth - 1);
    if (char === "(") parenDepth++;
    if (char === ")") parenDepth = Math.max(0, parenDepth - 1);
    if (char === "," && bracketDepth === 0 && parenDepth === 0) {
      selectors.push(current);
      current = "";
      continue;
    }
    current += char;
  }
  selectors.push(current);
  return selectors;
}

function scopeSelector(selector: string, scope: string, compositionId: string): string {
  const trimmed = selector.trim();
  if (!trimmed) return selector;
  if (/^(html|body|:root|\*)$/i.test(trimmed)) return selector;
  const compositionIdPattern = new RegExp(
    `data-composition-id\\s*=\\s*(["'])${escapeRegExp(compositionId)}\\1`,
  );
  if (compositionIdPattern.test(trimmed)) return selector;
  const leading = selector.match(/^\s*/)?.[0] ?? "";
  const trailing = selector.match(/\s*$/)?.[0] ?? "";
  return `${leading}${scope} ${trimmed}${trailing}`;
}

function scopeSelectorList(selectorText: string, scope: string, compositionId: string): string {
  return splitSelectorList(selectorText)
    .map((selector) => scopeSelector(selector, scope, compositionId))
    .join(",");
}

function scopeCssBlock(css: string, scope: string, compositionId: string): string {
  let output = "";
  let index = 0;
  const globalAtRules = new Set(["keyframes", "-webkit-keyframes", "font-face"]);

  while (index < css.length) {
    const braceIndex = findNextCssToken(css, index, "{");
    if (braceIndex < 0) {
      output += css.slice(index);
      break;
    }

    const semicolonIndex = findNextCssToken(css, index, ";");
    if (semicolonIndex >= 0 && semicolonIndex < braceIndex) {
      output += css.slice(index, semicolonIndex + 1);
      index = semicolonIndex + 1;
      continue;
    }

    const closeIndex = findMatchingCssBrace(css, braceIndex);
    if (closeIndex < 0) {
      output += css.slice(index);
      break;
    }

    const prelude = css.slice(index, braceIndex);
    const body = css.slice(braceIndex + 1, closeIndex);
    const trimmedPrelude = prelude.trim();
    if (trimmedPrelude.startsWith("@")) {
      const atRuleName = trimmedPrelude.match(/^@([-\w]+)/)?.[1]?.toLowerCase() ?? "";
      const scopedBody = globalAtRules.has(atRuleName)
        ? body
        : scopeCssBlock(body, scope, compositionId);
      output += `${prelude}{${scopedBody}}`;
    } else {
      output += `${scopeSelectorList(prelude, scope, compositionId)}{${body}}`;
    }
    index = closeIndex + 1;
  }

  return output;
}

export function scopeCssToComposition(css: string, compositionId: string): string {
  const trimmedCompositionId = compositionId.trim();
  if (!css || !trimmedCompositionId) return css;
  const scope = `[data-composition-id="${escapeCssAttributeValue(trimmedCompositionId)}"]`;
  return scopeCssBlock(css, scope, trimmedCompositionId);
}

export function wrapScopedCompositionScript(
  source: string,
  compositionId: string,
  errorLabel = "[HyperFrames] composition script error:",
): string {
  const compositionIdLiteral = JSON.stringify(compositionId);
  const errorLabelLiteral = JSON.stringify(errorLabel);
  return `(function(){
  var __hfCompId = ${compositionIdLiteral};
  var __hfErrorLabel = ${errorLabelLiteral};
  var __hfEscapeAttr = function(value) {
    return (value + "").replace(/\\\\/g, "\\\\\\\\").replace(/"/g, "\\\\\\"");
  };
  var __hfRootSelector = __hfCompId
    ? '[data-composition-id="' + __hfEscapeAttr(__hfCompId) + '"]'
    : "";
  var __hfRoot = null;
  var __hfFindRoot = function() {
    if (!__hfRoot && __hfRootSelector) {
      __hfRoot = window.document.querySelector(__hfRootSelector);
    }
    return __hfRoot;
  };
  var __hfContains = function(node) {
    var root = __hfFindRoot();
    return !root || node === root || root.contains(node);
  };
  var __hfQueryAll = function(selector) {
    var root = __hfFindRoot();
    if (!root || typeof selector !== "string") {
      return window.document.querySelectorAll(selector);
    }
    return Array.prototype.filter.call(window.document.querySelectorAll(selector), function(node) {
      return __hfContains(node);
    });
  };
  var __hfQueryOne = function(selector) {
    var matches = __hfQueryAll(selector);
    return matches[0] || null;
  };
  var __hfScopedDocument = typeof Proxy === "function"
    ? new Proxy(window.document, {
        get: function(target, prop, receiver) {
          if (prop === "querySelector") return __hfQueryOne;
          if (prop === "querySelectorAll") return __hfQueryAll;
          if (prop === "getElementById") {
            return function(id) {
              var found = target.getElementById(id);
              return found && __hfContains(found) ? found : null;
            };
          }
          var value = Reflect.get(target, prop, receiver);
          return typeof value === "function" ? value.bind(target) : value;
        },
      })
    : window.document;
  var __hfResolveGsapTarget = function(target) {
    if (typeof target !== "string") return target;
    return __hfQueryAll(target);
  };
  var __hfScopeTimeline = function(timeline) {
    if (!timeline || timeline.__hfScopedCompositionRoot === __hfFindRoot()) return timeline;
    ["to", "from", "fromTo", "set"].forEach(function(method) {
      var original = timeline[method];
      if (typeof original !== "function") return;
      timeline[method] = function(target) {
        var args = Array.prototype.slice.call(arguments);
        args[0] = __hfResolveGsapTarget(target);
        return original.apply(timeline, args);
      };
    });
    try {
      Object.defineProperty(timeline, "__hfScopedCompositionRoot", {
        value: __hfFindRoot(),
        configurable: true,
      });
    } catch (_err) {}
    return timeline;
  };
  var __hfBaseGsap = typeof gsap === "undefined" ? window.gsap : gsap;
  var __hfScopedGsap = !__hfBaseGsap || typeof Proxy !== "function"
    ? __hfBaseGsap
    : new Proxy(__hfBaseGsap, {
        get: function(target, prop, receiver) {
          if (prop === "timeline") {
            return function() {
              return __hfScopeTimeline(target.timeline.apply(target, arguments));
            };
          }
          if (prop === "to" || prop === "from" || prop === "fromTo" || prop === "set") {
            return function(firstArg) {
              var args = Array.prototype.slice.call(arguments);
              args[0] = __hfResolveGsapTarget(firstArg);
              return target[prop].apply(target, args);
            };
          }
          if (prop === "utils" && target.utils && typeof Proxy === "function") {
            return new Proxy(target.utils, {
              get: function(utilsTarget, utilsProp, utilsReceiver) {
                if (utilsProp === "toArray") {
                  return function(firstArg) {
                    var args = Array.prototype.slice.call(arguments);
                    args[0] = __hfResolveGsapTarget(firstArg);
                    return utilsTarget.toArray.apply(utilsTarget, args);
                  };
                }
                if (utilsProp === "selector") {
                  return function(base) {
                    var baseEl = typeof base === "string" ? __hfQueryOne(base) : base;
                    var root = baseEl || __hfFindRoot();
                    return function(selector) {
                      if (!root || typeof selector !== "string") return [];
                      return Array.prototype.slice.call(root.querySelectorAll(selector));
                    };
                  };
                }
                var value = Reflect.get(utilsTarget, utilsProp, utilsReceiver);
                return typeof value === "function" ? value.bind(utilsTarget) : value;
              },
            });
          }
          var value = Reflect.get(target, prop, receiver);
          return typeof value === "function" ? value.bind(target) : value;
        },
      });
  var __hfRun = function() {
    try {
      (function(document, gsap) {
${source}
      }).call(window, __hfScopedDocument, __hfScopedGsap);
    } catch (_err) {
      console.error(__hfErrorLabel, __hfCompId, _err);
    }
  };
  __hfFindRoot();
  __hfRun();
})()`;
}
