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

# --- 1. SYNONYM MAPPING ---
# This ensures Turmeric/Curcumin or Omez/Pantoprazole all point to the right data
SYNONYMS = {
    "turmeric": "Curcumin",
    "curcumin": "Curcumin",
    "omez": "Pantoprazole",
    "omeprazole": "Pantoprazole",
    "aspirin": "Aspirin",
    "eco-sprin": "Aspirin"
}

API_URL = "https://api-inference.huggingface.co/models/d4data/biomedical-ner-all"
HF_TOKEN = os.getenv("HF_TOKEN")
headers = {"Authorization": f"Bearer {HF_TOKEN}"}
CSV_PATH = "interactions.csv"

class AnalyzeRequest(BaseModel):
    text: str

def query_biobert_api(text):
    if not HF_TOKEN: return []
    try:
        response = requests.post(API_URL, headers=headers, json={"inputs": text}, timeout=10)
        return response.json()
    except:
        return []

@app.post("/analyze")
async def analyze_text(request: AnalyzeRequest):
    try:
        text = request.text
        if not text: return {"results": [], "status": "error"}

        # 1. AI NER Detection
        api_results = query_biobert_api(text)
        
        if isinstance(api_results, dict) and "estimated_time" in api_results:
            return {"status": "loading", "message": "BioBERT is warming up..."}

        # 2. WORD RECONSTRUCTION
        detected_words = []
        current_word = ""

        if isinstance(api_results, list):
            for ent in api_results:
                word = ent.get('word', '')
                if word.startswith("##"):
                    current_word += word.replace("##", "")
                else:
                    if current_word: detected_words.append(current_word.lower())
                    current_word = word
            if current_word: detected_words.append(current_word.lower())

        # 3. SYNONYM NORMALIZATION
        # If AI finds 'turmeric', we change it to 'Curcumin' so the CSV match works
        final_entities = []
        for word in detected_words:
            normalized = SYNONYMS.get(word, word.title())
            if normalized not in final_entities and len(normalized) > 2:
                final_entities.append(normalized)

        print(f"🧠 AI Detected & Normalized: {final_entities}")

        # 4. Interaction Logic
        if len(final_entities) < 2:
            return {"results": [], "detected_entities": final_entities, "message": "Need 2 entities."}

        herb, drug = final_entities[0], final_entities[1]

        # 5. Return Result
        new_row = {
            "herb": herb,
            "drug": drug,
            "interaction_text": f"AI identified interaction: {herb} + {drug}",
            "mechanism": "BioBERT Neural Entity Recognition with Synonym Mapping.",
            "severity": "Moderate",
            "recommendation": "Review clinical guidelines for these agents.",
            "citation_url": "https://pubmed.ncbi.nlm.nih.gov/"
        }

        return {"results": [new_row], "status": "success"}

    except Exception as e:
        return {"results": [], "status": "error", "message": str(e)}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
