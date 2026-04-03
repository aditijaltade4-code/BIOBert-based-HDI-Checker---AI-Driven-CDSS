import pandas as pd
import os
import re
import requests
from fastapi import FastAPI, HTTPException, Request
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

# Updated to include common chemicals/acids the AI might skip
KNOWN_ENTITIES = [
    "Triphala", "Ashwagandha", "Guggulu", "Amalaki", "Brahmi", 
    "Shatavari", "Tulsi", "Turmeric", "Curcumin", "Neem", "Giloy",
    "Gallic Acid", "Aspirin", "Metformin", "Diclofenac", "Pantoprazole", "Omez"
]

class AnalyzeRequest(BaseModel):
    text: str

def query_biobert_api(text):
    if not HF_TOKEN:
        print("⚠️ HF_TOKEN missing from Environment Variables")
        return []
    try:
        # Reduced timeout slightly for better responsiveness
        response = requests.post(API_URL, headers=headers, json={"inputs": text}, timeout=8)
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

        found_entities = []

        # 1. AI NER Detection
        api_results = query_biobert_api(text)
        
        if isinstance(api_results, dict) and "estimated_time" in api_results:
            # Instead of stopping, we proceed to Manual Check even if AI is loading
            print("⏳ AI Loading... falling back to manual detection.")
        
        elif isinstance(api_results, list):
            for ent in api_results:
                word = ent.get('word', '').replace('##', '').strip().title()
                if word and len(word) > 2:
                    found_entities.append(word)
        
        # 2. Manual Check (The "Safety Net")
        # This catches "Gallic Acid" and "Aspirin" even if the AI is offline
        for item in KNOWN_ENTITIES:
            if item.lower() in text.lower():
                if item.title() not in found_entities:
                    found_entities.append(item.title())

        # 3. Deduplicate
        seen = set()
        found_entities = [x for x in found_entities if not (x.lower() in seen or seen.add(x.lower()))]

        # 4. Logic Check
        if len(found_entities) < 2:
            return {
                "results": [], 
                "detected_entities": [{"entity": e, "type": "CHEMICAL"} for e in found_entities],
                "status": "success",
                "message": "Need at least an herb and a drug to analyze interactions."
            }

        # 5. Interaction Mapping & Data Normalization
        herb, drug = found_entities[0], found_entities[1]
        
        # Normalize Omez/Omeprazole to Pantoprazole as per your dataset correction
        if drug.lower() in ["omez", "omeprazole"]:
            drug = "Pantoprazole"
        if herb.lower() in ["omez", "omeprazole"]:
            herb = "Pantoprazole"

        new_row = {
            "herb": herb,
            "drug": drug,
            "interaction_text": f"Potential clinical interaction identified between {herb} and {drug}.",
            "mechanism": "BioBERT NLP or Manual Entity Matching identified clinical co-administration.",
            "evidence_level": "High (Clinical Flag)",
            "severity": "Moderate",
            "recommendation": "Consult pharmacist. Monitor for altered therapeutic efficacy.",
            "citation_url": "https://pubmed.ncbi.nlm.nih.gov/"
        }

        # 6. CSV Logging (Handles the case where data/ folder doesn't exist)
        if os.path.exists(CSV_PATH):
            try:
                df = pd.read_csv(CSV_PATH)
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
    # 0.0.0.0 is MANDATORY for Render
    uvicorn.run(app, host="0.0.0.0", port=8000)
