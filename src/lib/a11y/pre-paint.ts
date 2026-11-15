/**
 * v2.5 Module 8 — Pre-paint script (§3.3).
 *
 * A ~1 KB inline script injected in <head> BEFORE the app boots: it reads the
 * localStorage mirrors of the a11y and privacy preferences and applies the
 * same data-attributes / CSS variables as applyA11yToDocument(), so settings
 * are visible on the very first paint — no flash, no layout shift, and it
 * works logged out (per-device). After hydration the providers reconcile
 * with the server profile.
 *
 * The attribute names MUST stay in sync with src/lib/a11y/preferences.ts
 * (applyA11yToDocument) and src/lib/privacy/store.ts.
 */

/** Minified-by-hand source of the pre-paint script. */
export const PRE_PAINT_SCRIPT = `(function(){try{
var d=document.documentElement;
function a(p){try{return p?JSON.parse(p):null}catch(e){return null}}
var q=a(localStorage.getItem("tj-a11y"));
if(q){
if(q.textScale&&q.textScale!==100)d.style.fontSize=q.textScale+"%";
if(q.contrastMode==="HIGH"||q.contrastMode==="STANDARD")d.setAttribute("data-contrast",q.contrastMode.toLowerCase());
if(q.reducedMotion==="ON"||q.reducedMotion==="OFF")d.setAttribute("data-motion",q.reducedMotion.toLowerCase());
if(q.fontFamily==="DYSLEXIA_FRIENDLY")d.setAttribute("data-font","dyslexia-friendly");
else if(q.fontFamily==="MONO_NUMBERS")d.setAttribute("data-font","mono-numbers");
if(q.lineHeight)d.style.setProperty("--a11y-line-height",q.lineHeight/100);
if(q.letterSpacing)d.style.setProperty("--a11y-letter-spacing",q.letterSpacing/1000+"em");
if(q.focusRingStyle==="ENHANCED")d.setAttribute("data-focus-ring","enhanced");
if(q.largerTouchTargets)d.setAttribute("data-touch","large");
if(q.underlineLinks)d.setAttribute("data-underline-links","1");
if(q.tabularNumbers)d.setAttribute("data-tabular-nums","1");
}
var r=a(localStorage.getItem("tj-privacy"));
if(r&&r.mode&&r.mode!=="OFF"){
d.setAttribute("data-privacy",r.mode.toLowerCase());
if(r.revealOnHover===false)d.setAttribute("data-privacy-reveal","0");
}
}catch(e){}})();`;
