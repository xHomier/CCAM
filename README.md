# CCAM

Webapp de surveillance auto-hébergée pour caméras Reolink (RLC-810A et compatibles) : live view, enregistrement continu sur NAS, et alertes basées sur la détection IA embarquée de la caméra (personne / véhicule / animal). Une seule interface responsive : PWA installable sur téléphone, site normal sur desktop.

## Architecture

- **proxy** (nginx) — point d'entrée unique (port `HTTP_PORT`), sert le frontend et reverse-proxy `/api` (backend) et `/live` (go2rtc).
- **backend** (Node.js/Fastify) — API REST + SSE, polling de l'API Reolink pour les événements IA, gestion des enregistrements ffmpeg, SQLite.
- **go2rtc** — restream RTSP → MSE/WebRTC/HLS pour le live view dans le navigateur.

## Prérequis avant le premier démarrage

Cette configuration cible un déploiement Linux/Portainer sur le même réseau que les caméras. Elle ne fonctionne **pas** telle quelle sur Docker Desktop (Windows/Mac) — le réseau macvlan et le driver NFS de volume sont spécifiques à un hôte Docker Linux.

1. **Créer le réseau macvlan** sur l'hôte Docker (une fois, en dehors de Compose), par ex. :
   ```bash
   docker network create -d macvlan \
     --subnet=10.2.5.0/24 --gateway=10.2.5.1 \
     -o parent=eth0 lan
   ```
   Adapter le sous-réseau/interface (`parent`) à ton réseau réel.
2. Copier `.env.example` en `.env` et remplir :
   - `TZ` — fuseau horaire (doit être cohérent pour les horodatages d'enregistrement/rétention).
   - `PROXY_LAN_IP` — IP statique du proxy sur le réseau macvlan (doit être libre sur ce sous-réseau).
   - `NAS_NFS_ADDR` / `NAS_NFS_PATH` — adresse du serveur NFS et chemin d'export dédié à CCAM (pas partagé avec une autre appli NVR).
   - `ADMIN_USERNAME` / `ADMIN_PASSWORD` — premier compte admin (créé automatiquement au premier démarrage si la base est vide). Change le mot de passe par défaut.
   - `SESSION_KEY` — clé de chiffrement des cookies de session, générer avec `openssl rand -hex 32`.
3. Ajouter tes caméras via l'UI (Réglages → Caméras, compte admin requis) : IP, identifiants RTSP et identifiants de l'API HTTP Reolink.

**Note macvlan** : un hôte Docker ne peut généralement pas joindre directement ses propres conteneurs macvlan (limitation connue du driver). Si `cloudflared` tourne directement sur l'hôte plutôt qu'en conteneur sur le même réseau `lan`, vérifie qu'il peut bien atteindre `${PROXY_LAN_IP}` — sinon, accès de secours via l'hôte sur le port `HTTP_PORT`.

## Démarrage

```bash
docker compose up -d --build
```

Puis ouvrir `http://<host>:${HTTP_PORT:-8080}` et te connecter avec le compte admin défini dans `.env`.

## Rôles

- **admin** : gère les caméras, les utilisateurs, la rétention, peut supprimer événements/enregistrements.
- **user** : accès en lecture seule au live, aux événements et aux enregistrements.

De nouveaux comptes se créent depuis Réglages → Utilisateurs (admin uniquement) — pas d'inscription publique.

## WebRTC (optionnel)

Le live view fonctionne par défaut en MSE via WebSocket, sans configuration réseau supplémentaire. go2rtc tourne avec sa config par défaut (pas de fichier monté — un montage relatif vers un fichier du dépôt ne se résout pas de façon fiable sous un stack Portainer en mode "Repository", qui ne clone pas l'arbre complet du dépôt à côté du fichier compose). Pour activer le WebRTC (latence plus faible), il faudrait fournir un `candidates` ICE à go2rtc — par ex. via le bloc `configs:` inline de Docker Compose (contenu YAML directement dans `docker-compose.yml`, sans dépendre d'un fichier sur l'hôte) plutôt qu'un bind mount.
