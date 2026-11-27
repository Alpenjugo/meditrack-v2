# Offizielles Multi-Arch-Python-Image (amd64, aarch64, armv7) – keine Zusatzpakete nötig.
FROM python:3.12-alpine

ENV PYTHONUNBUFFERED=1 \
    MEDITRACK_DB=/data/meditrack.db \
    MEDITRACK_PORT=8099

WORKDIR /app
COPY app/ /app/

EXPOSE 8099
CMD ["python3", "/app/server.py"]
