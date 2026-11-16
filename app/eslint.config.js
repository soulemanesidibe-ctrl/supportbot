import js from "@eslint/js";
import reactHooks from "eslint-plugin-react-hooks";
import globals from "globals";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["dist", "node_modules", "functions/**/*.js"] },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ["**/*.{ts,tsx}"],
    languageOptions: { ecmaVersion: 2023, globals: globals.browser },
    plugins: { "react-hooks": reactHooks },
    rules: {
      ...reactHooks.configs.recommended.rules,
      // Aucun HTML brut injecté : tout contenu externe (message, ticket, alerte) est une donnée affichée comme texte.
      "no-restricted-syntax": [
        "error",
        { selector: "JSXAttribute[name.name='dangerouslySetInnerHTML']", message: "Interdit : afficher le contenu comme texte (règle n° 4)." },
      ],
      "no-restricted-properties": [
        "error",
        { object: "localStorage", property: "setItem", message: "Seules les préférences d'affichage passent par src/lib/prefs.ts ; jamais un jeton (SEC-23)." },
        { object: "sessionStorage", property: "setItem", message: "Aucun jeton dans le stockage du navigateur (SEC-23)." },
      ],
    },
  },
  {
    // Le module des préférences, et son test qui simule un stockage corrompu.
    files: ["src/lib/prefs.ts", "src/lib/prefs.test.ts"],
    rules: { "no-restricted-properties": "off" },
  },
);
