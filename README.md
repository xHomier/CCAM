# CCAM

Webapp de surveillance auto-hébergée pour caméras Reolink (RLC-810A et compatibles) : live view, enregistrement continu sur NAS, et alertes basées sur la détection IA embarquée de la caméra (personne / véhicule / animal). Une seule interface responsive : PWA installable sur téléphone, site normal sur desktop.

## Architecture

- **proxy** (nginx) — point d'entrée unique (port `HTTP_PORT`), sert le frontend et reverse-proxy `/api` (backend) et `/live` (go2rtc).
- **backend** (Node.js/Fastify) — API REST + SSE, polling de l'API Reolink pour les événements IA, gestion des enregistrements ffmpeg, SQLite.
- **go2rtc** — restream RTSP → MSE/WebRTC/HLS pour le live view dans le navigateur.

## Prérequis avant le premier démarrage

1. **Monter le partage NAS** sur la machine hôte (SMB ou NFS, via `/etc/fstab` ou équivalent) à un chemin de ton choix, p. ex. `/mnt/nas/ccam`. Le conteneur `backend` doit pouvoir y écrire.
2. Copier `.env.example` en `.env` et remplir :
   - `TZ` — fuseau horaire (doit être cohérent pour les horodatages d'enregistrement/rétention).
   - `NAS_MOUNT_PATH` — chemin hôte du montage NAS de l'étape 1.
   - `ADMIN_USERNAME` / `ADMIN_PASSWORD` — premier compte admin (créé automatiquement au premier démarrage si la base est vide). Change le mot de passe par défaut.
   - `SESSION_KEY` — clé de chiffrement des cookies de session, générer avec `openssl rand -hex 32`.
3. Ajouter tes caméras via l'UI (Réglages → Caméras, compte admin requis) : IP, identifiants RTSP et identifiants de l'API HTTP Reolink.

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

Le live view fonctionne par défaut en MSE via le proxy nginx, sans configuration réseau supplémentaire. Pour activer le WebRTC (latence plus faible), voir les commentaires dans `go2rtc/go2rtc.yaml` — nécessite d'exposer le port UDP/TCP `8555` et de définir l'IP LAN du serveur comme candidat ICE.
