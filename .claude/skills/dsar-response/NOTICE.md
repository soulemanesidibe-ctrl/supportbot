Source : https://github.com/anthropics/claude-for-legal/tree/main/privacy-legal/skills/dsar-response (Apache License 2.0).
Licence complète : `.claude/skills/_third-party-licenses/claude-for-legal-APACHE-2.0.txt`.
Adapté pour SupportBot : chemins de playbook redirigés de `~/.claude/plugins/config/claude-for-legal/...`
vers `docs/legal/` (playbooks versionnés dans le repo au lieu d'une config globale par utilisateur) ;
skills `customize`, `matter-workspace` du plugin amont non vendorisés (hors périmètre) ; `cold-start-interview`
renommé `commercial-legal-setup` / `privacy-legal-setup` pour éviter la collision de nom entre les deux plugins.
