import { THEME_STORAGE_KEY } from "./theme-key";

/** Inline script for <head>: runs before first paint. Must match readTheme/applyTheme in theme.ts. */
export const THEME_INIT_SCRIPT = `try{var t=localStorage.getItem(${JSON.stringify(
  THEME_STORAGE_KEY,
)});if(t==="light"||t==="dark")document.documentElement.dataset.theme=t}catch(e){}`;
