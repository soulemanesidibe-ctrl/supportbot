// Textes fixes montrés au salarié. Rédigés par nous, jamais par le modèle : ils sont identiques quelle que soit la cause (aucune
// information sur la règle qui a joué, M02). Chacun rappelle qu'il s'agit d'un assistant IA et qu'un humain reprend (règle n° 1).
// Français d'abord ; l'anglais arrive avec l'internationalisation de l'interface (J5).

export const TEXTS = {
  /** Catégorie pas encore ouverte (mode ombre) : AUCUN texte de l'IA, seulement ce message fixe. */
  shadow:
    "Votre demande est bien enregistrée. Un technicien va vous répondre dans les meilleurs délais. Relève, l'assistant IA du support, prépare votre demande pour l'équipe.",
  /** L'IA ne sait pas, ou doute, ou n'est pas joignable : on passe la main sans faire attendre. */
  escalated:
    "Je transmets votre demande à un technicien, qui reprendra la conversation. Vous n'aurez pas à répéter. Je suis un assistant IA : un humain prend le relais.",
  /** Demande d'action sur un compte : jamais traitée dans le chat. */
  accountAction:
    "Pour une action sur un compte (mot de passe, authentification à deux facteurs, déblocage), un technicien doit d'abord vérifier votre identité par un autre moyen. Votre demande lui est transmise : il vous contactera.",
  /** Demande suspecte : réponse neutre, sans dire pourquoi. */
  suspect: "Je ne peux pas traiter cette demande ici. Un technicien va vous contacter.",
  /** Arrêt d'urgence de l'organisation. */
  frozen: "Le support automatique est momentanément suspendu pour votre organisation. Un technicien va prendre le relais.",
  /** Le salarié a demandé un technicien (« Parler à un technicien ») sur une demande en cours. */
  humanRequested:
    "Votre demande est transmise à un technicien, avec ce qui a déjà été vérifié : vous n'aurez pas à répéter. Il vous répondra ici.",
  /** Le salarié a écrit directement à un technicien : l'IA ne traite pas ce message. */
  direct:
    "Votre message est transmis directement à un technicien, qui vous répondra ici. Relève, l'assistant IA du support, ne répond pas à cette demande.",
  /** « Non, toujours pas » après une réponse de l'IA : un humain reprend. */
  notWorked:
    "C'est noté : la solution proposée n'a pas suffi. Votre demande passe à un technicien, avec ce qui a déjà été essayé. Il vous répondra ici.",
} as const;

export const CATEGORY_LABELS: Readonly<Record<string, string>> = {
  password: "Mot de passe",
  mfa: "Authentification à deux facteurs",
  vpn: "VPN",
  printer: "Imprimante",
  outlook: "Outlook",
  teams: "Teams",
  onedrive: "OneDrive",
  slow_pc: "Poste lent",
  onboarding: "Arrivée",
  offboarding: "Départ",
  other: "Demande",
};
