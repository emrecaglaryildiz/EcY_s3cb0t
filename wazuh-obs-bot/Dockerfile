# ── Python Bot Image ──────────────────────────────────────────────────────────
FROM python:3.12-slim

WORKDIR /app

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    CHROME_BIN=/usr/bin/chromium \
    CHROMEDRIVER_PATH=/usr/bin/chromedriver

# Sistem bağımlılıkları
RUN apt-get update && apt-get install -y --no-install-recommends \
    libxml2 \
    libxslt1.1 \
    chromium \
    chromium-driver \
    && rm -rf /var/lib/apt/lists/*

# Python bağımlılıkları
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

# Kaynak kodu kopyala
COPY *.py ./

# Non-root kullanıcı (güvenlik)
RUN adduser --disabled-password --gecos "" botuser
USER botuser

CMD ["python", "-u", "bot.py"]
