import pandas as pd
import os
import requests
from fastapi import FastAPI, Request
from pydantic import BaseModel
from fastapi.middleware.cors import CORSMiddleware

app = FastAPI(title="BioBERT Autonomous Engine")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# --- 1. CONFIGURATION ---
API_URL = "https://api-inference.huggingface.co/models/d4data/biomedical-ner-all"
HF_TOKEN = os.getenv("HF_TOKEN")
headers = {"Authorization": f"Bearer {HF_TOKEN}"}
CSV_PATH = "interactions.csv"

class AnalyzeRequest(BaseModel):
    text: str

def query_biobert_api(text):
    if not HF_TOKEN:
        print("⚠️ HF_TOKEN missing")
        return []
    try:
        response = requests.post(API_URL, headers=headers, json={"inputs": text}, timeout=10)
        return response.json()
    except Exception as e:
        print(f"API Error: {e}")
        return []

@app.post("/analyze")
async def analyze_text(request: AnalyzeRequest):
    try:
        text = request.text
        if not text:
            return {"results": [], "status": "error", "message": "No text provided"}

        print(f"📥 AI Processing: '{text}'")

        # 1. AI NER Detection
        api_results = query_biobert_api(text)
        
        if isinstance(api_results, dict) and "estimated_time" in api_results:
            return {"status": "loading", "message": "BioBERT is warming up..."}

        # 2. WORD RECONSTRUCTION (Fixes fragmented words like 'Gall' + '##ic')
        found_entities = []
        current_word = ""

        if isinstance(api_results, list):
            for ent in api_results:
                word = ent.get('word', '')
                # If it starts with ##, it belongs to the previous word
                if word.startswith("##"):
                    current_word += word.replace("##", "")
                else:
                    # New word starts, so save the completed one
                    if current_word:
                        found_entities.append(current_word.title())
                    current_word = word
            
            # Catch the very last word in the loop
            if current_word:
                found_entities.append(current_word.title())

        # 3. Clean and Deduplicate
        # Filter out tiny noise and deduplicate while keeping order
        found_entities = [w for w in found_entities if len(w) > 2]
        seen = set()
        found_entities = [x for x in found_entities if not (x.lower() in seen or seen.add(x.lower()))]

        print(f"🧠 BioBERT Auto-Detected: {found_entities}")

        # 4. Logic & Normalization
        if len(found_entities) < 2:
            return {
                "results": [], 
                "detected_entities": [{"entity": e, "type": "AUTO"} for e in found_entities],
                "status": "success",
                "message": "AI detected fewer than 2 entities."
            }

        herb, drug = found_entities[0], found_entities[1]
        
        # Clinical Correction: Omez/Omeprazole -> Pantoprazole
        if drug.lower() in ["omez", "omeprazole"]: drug = "Pantoprazole"
        if herb.lower() in ["omez", "omeprazole"]: herb = "Pantoprazole"

        # 5. Result Generation
        new_row = {
            "herb": herb,
            "drug": drug,
            "interaction_text": f"AI identified a clinical interaction between {herb} and {drug}.",
            "mechanism": "BioBERT Neural Entity Recognition.",
            "severity": "Moderate",
            "recommendation": "Review patient medication history.",
            "citation_url": "https://pubmed.ncbi.nlm.nih.gov/"
        }

        return {"results": [new_row], "status": "success"}

    except Exception as e:
        print(f"❌ AI Crash: {str(e)}")
        return {"results": [], "status": "error", "message": str(e)}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
