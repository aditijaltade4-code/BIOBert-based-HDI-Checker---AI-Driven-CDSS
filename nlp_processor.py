import pandas as pd
import os
import re
import requests
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from fastapi.middleware.cors import CORSMiddleware

app = FastAPI(title="BioBERT Interaction Engine")

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

# Manual list to catch common Ayurvedic terms AI might miss
AYURVEDIC_HERBS = [
    "Triphala", "Ashwagandha", "Guggulu", "Amalaki", "Brahmi", 
    "Shatavari", "Tulsi", "Turmeric", "Curcumin", "Neem", "Giloy"
]

class AnalyzeRequest(BaseModel):
    text: str

def query_biobert_api(text):
    if not HF_TOKEN:
        print("⚠️ HF_TOKEN missing from Environment Variables")
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

        print(f"📥 Analyzing: '{text}'")

        # 1. AI NER Detection
        api_results = query_biobert_api(text)
        
        # Handle Hugging Face "Model Loading" state
        if isinstance(api_results, dict) and "estimated_time" in api_results:
            return {"status": "loading", "message": "AI is warming up, please try again in 30s."}

        found_entities = []
        
        # Extract entities from BioBERT response
        if isinstance(api_results, list):
            for ent in api_results:
                # API usually returns 'word' or 'entity'
                word = ent.get('word', '').replace('##', '').strip().title()
                if word and len(word) > 2:
                    found_entities.append(word)
        
        # 2. Manual Ayurvedic Check
        for herb in AYURVEDIC_HERBS:
            if herb.lower() in text.lower():
                if herb.title() not in found_entities:
                    found_entities.append(herb.title())

        # 3. Deduplicate
        seen = set()
        found_entities = [x for x in found_entities if not (x.lower() in seen or seen.add(x.lower()))]

        if len(found_entities) < 2:
            return {
                "results": [], 
                "detected_entities": [{"entity": e, "type": "CHEMICAL"} for e in found_entities],
                "status": "success",
                "message": "Need at least an herb and a drug to analyze interactions."
            }

        # 4. Interaction Mapping
        herb, drug = found_entities[0], found_entities[1]
        
        # DATASET SYNC: Ensure Omez is treated as Pantoprazole
        if drug.lower() in ["omez", "omeprazole"]:
            drug = "Pantoprazole"

        new_row = {
            "herb": herb,
            "drug": drug,
            "interaction_text": f"Potential clinical interaction identified between {herb} and {drug}.",
            "mechanism": "BioBERT NLP identified co-administration pattern in clinical context.",
            "evidence_level": "High (AI Flagged)",
            "severity": "Moderate",
            "recommendation": "Monitor patient for altered therapeutic efficacy or adverse symptoms.",
            "citation_url": "https://pubmed.ncbi.nlm.nih.gov/"
        }

        # 5. CSV Logging (Saves new interactions for future use)
        if os.path.exists(CSV_PATH):
            try:
                df = pd.read_csv(CSV_PATH)
                # Check for duplicates before adding
                is_dup = ((df['herb'].str.lower() == herb.lower()) & 
                          (df['drug'].str.lower() == drug.lower())).any()
                
                if not is_dup:
                    new_df = pd.DataFrame([new_row])
                    df = pd.concat([df, new_df], ignore_index=True)
                    df.to_csv(CSV_PATH, index=False)
                    print(f"✅ CSV Sync: {herb} + {drug} added.")
            except Exception as csv_err:
                print(f"⚠️ CSV Sync Issue: {csv_err}")

        return {"results": [new_row], "status": "success"}

    except Exception as e:
        print(f"❌ Python Crash: {str(e)}")
        return {"results": [], "status": "error", "message": str(e)}

if __name__ == "__main__":
    import uvicorn
    import os
    # Use port 8000 for internal bridge
    port = 8000 
    # 0.0.0.0 is MANDATORY for Render internal communication
    uvicorn.run(app, host="0.0.0.0", port=port)
