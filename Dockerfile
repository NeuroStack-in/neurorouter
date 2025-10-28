FROM python:3.11-slim

# (optional) build tools for some pip packages
RUN apt-get update && apt-get install -y --no-install-recommends build-essential && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# copy deps first for layer caching
COPY requirements.txt .

RUN pip install --no-cache-dir -r requirements.txt

# copy the rest of your code
COPY . .

# app listens on 7860 (change if yours uses a different port)
EXPOSE 7860

# start the app; keep this if you have run.py in project root
CMD ["python", "run.py"]
