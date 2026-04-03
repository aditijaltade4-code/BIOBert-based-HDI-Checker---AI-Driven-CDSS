#!/bin/bash

# 1. Start the Python FastAPI backend using Gunicorn
# -w 1: Use 1 worker (to save RAM on Render's Free Tier)
# -k uvicorn.workers.UvicornWorker: Tells Gunicorn to use Uvicorn for FastAPI
# --bind 127.0.0.1:8000: Keeps Python "hidden" so only Node can talk to it
gunicorn -w 1 -k uvicorn.workers.UvicornWorker nlp_processor:app --bind 127.0.0.1:8000 &

# 2. Give the Python backend a 5-second head start to initialize
sleep 5

# 3. Start the Node.js frontend/bridge
# This binds to Render's public PORT (e.g., 10000)
node server.js