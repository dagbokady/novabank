# NOVA BANK — image du challenge. Python seul, aucune dependance externe.
FROM python:3.12-alpine

# Utilisateur non privilegie (le serveur ne tourne jamais en root).
RUN addgroup -S app && adduser -S app -G app

WORKDIR /app

COPY server.py ./
COPY lib ./lib
COPY api ./api
COPY public ./public

USER app

ENV PORT=8080
EXPOSE 8080

CMD ["python3", "server.py"]
