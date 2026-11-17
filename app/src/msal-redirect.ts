// Page de retour de la fenêtre Microsoft : transmet la réponse à la console (canal du navigateur, compatible avec l'isolement
// « Cross-Origin-Opener-Policy: same-origin ») puis se ferme. Aucun jeton n'est lu ni gardé ici.
import { broadcastResponseToMainFrame } from "@azure/msal-browser/redirect-bridge";

void broadcastResponseToMainFrame().catch(() => {
  document.body.textContent = "La connexion Microsoft n'a pas abouti. Fermez cette fenêtre et recommencez depuis la console.";
});
