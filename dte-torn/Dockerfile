# syntax=docker/dockerfile:1

# ---------------------------------------------------------------- builder ----
FROM python:3.12-slim-bookworm AS builder

# libxml2-dev / libxslt1-dev / libxmlsec1-dev: cabeceras contra las que se
# compilan lxml y xmlsec. libxslt1-dev no es opcional aunque acá no se use XSLT:
# lxml linkea contra libxslt siempre y sin sus cabeceras no compila.
# libxmlsec1-openssl es el backend criptográfico que xmlsec carga en runtime vía
# libltdl; sin él, xmlsec importa pero no firma.
RUN apt-get update && apt-get install -y --no-install-recommends \
        build-essential \
        pkg-config \
        libxml2-dev \
        libxslt1-dev \
        zlib1g-dev \
        libxmlsec1-dev \
        libxmlsec1-openssl \
        libltdl-dev \
    && rm -rf /var/lib/apt/lists/*

ENV VIRTUAL_ENV=/opt/venv PATH=/opt/venv/bin:$PATH
RUN python -m venv "$VIRTUAL_ENV"

COPY requirements.txt .

# --no-binary lxml,xmlsec: obliga a compilar ambos contra la libxml2 del
# sistema. Ver el comentario en requirements.txt - con los wheels, firmar
# segfaultea. Es lo que hace lento este build; el resto sí usa wheels.
RUN pip install --no-cache-dir --upgrade pip \
    && pip install --no-cache-dir --no-binary lxml,xmlsec -r requirements.txt

# ---------------------------------------------------------------- runtime ----
FROM python:3.12-slim-bookworm AS runtime

RUN apt-get update && apt-get install -y --no-install-recommends \
        libxml2 \
        libxslt1.1 \
        libxmlsec1 \
        libxmlsec1-openssl \
        libltdl7 \
    && rm -rf /var/lib/apt/lists/*

ENV VIRTUAL_ENV=/opt/venv \
    PATH=/opt/venv/bin:$PATH \
    PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1

COPY --from=builder /opt/venv /opt/venv

WORKDIR /srv
COPY alembic.ini ./
COPY alembic ./alembic
COPY app ./app

RUN useradd --system --no-create-home --uid 10001 dte \
    && chown -R dte:dte /srv
USER dte

EXPOSE 8000
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]

# ------------------------------------------------------------------- dev ----
# Los tests corren acá dentro, no en el host: lo que se prueba de xmlsec depende
# de la libxmlsec1 de esta imagen, y lo de folios y RLS, de PostgreSQL.
FROM runtime AS dev

USER root
COPY requirements-dev.txt ./
RUN pip install --no-cache-dir -r requirements-dev.txt
COPY pytest.ini ./
COPY tests ./tests
RUN chown -R dte:dte /srv
USER dte

CMD ["pytest"]
