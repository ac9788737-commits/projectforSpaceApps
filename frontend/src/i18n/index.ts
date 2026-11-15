import i18n from "i18next";
import { initReactI18next, useTranslation } from "react-i18next";
import en from "./en.json";
import ru from "./ru.json";
import tg from "./tg.json";

/** RU / EN / TG for the farmer screens (docs/IMPROVEMENTS.md B12). The server writes its own
 * sentences in the asked language too, so every request carries `lang`. */
export type Lang = "ru" | "en" | "tg";
export const LANGS: { id: Lang; label: string }[] = [
  { id: "ru", label: "RU" },
  { id: "en", label: "EN" },
  { id: "tg", label: "TG" },
];
const KEY = "astrocrop.lang";
const LOCALE: Record<Lang, string> = { ru: "ru-RU", en: "en-US", tg: "ru-RU" };

function initial(): Lang {
  try {
    const v = localStorage.getItem(KEY);
    if (v === "ru" || v === "en" || v === "tg") return v;
  } catch {
    /* no storage: the default */
  }
  return "en"; // English by default; the choice on the landing or in the app is remembered
}

void i18n.use(initReactI18next).init({
  resources: { ru: { translation: ru }, en: { translation: en }, tg: { translation: tg } },
  lng: initial(),
  fallbackLng: "ru",
  interpolation: { escapeValue: false },
});
if (typeof document !== "undefined") document.documentElement.lang = i18n.language;

export function setLang(l: Lang) {
  void i18n.changeLanguage(l);
  document.documentElement.lang = l;
  try {
    localStorage.setItem(KEY, l);
  } catch {
    /* the choice lives until the page closes */
  }
}

export const lang = (): Lang => (i18n.language as Lang) ?? "ru";
/** Number/date locale for the current language. */
export const locale = (): string => LOCALE[lang()];
export const num = (v: number, digits?: number) =>
  v.toLocaleString(locale(), digits === undefined ? undefined : { maximumFractionDigits: digits });

/** Current language; re-renders the component when it changes. */
export function useLang(): Lang {
  const { i18n: x } = useTranslation();
  return (x.language as Lang) ?? "ru";
}

export default i18n;
