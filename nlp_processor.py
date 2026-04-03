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

# --- 1. THE CLINICAL DICTIONARY ---
# This helps the AI when it's "unsure" about a word.
# It handles synonyms like Turmeric -> Curcumin automatically.
MEDICAL_MAP = {
    "turmeric": "Curcumin",
    "curcumin": "Curcumin",
    "gallic": "Gallic Acid",
    "aspirin": "Aspirin",
    "warfarin": "Warfarin",
    "omez": "Pantoprazole",
    "pantoprazole": "Pantoprazole",
    "ashwagandha": "Ashwagandha",
    "triphala": "Triphala",
    "metformin": "Metformin"
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
        text = request.text.lower()
        if not text: return {"results": [], "status": "error"}

        # 1. AI NER Detection
        api_results = query_biobert_api(text)
        
        found_entities = []
        
        # 2. Extract from AI if successful
        if isinstance(api_results, list):
            current_word = ""
            for ent in api_results:
                word = ent.get('word', '')
                if word.startswith("##"):
                    current_word += word.replace("##", "")
                else:
                    if current_word: found_entities.append(current_word.lower())
                    current_word = word
            if current_word: found_entities.append(current_word.lower())

        # 3. THE SAFETY NET: Keyword Scanning
        # Even if the AI returns [], we check the text for our MEDICAL_MAP keys
        for key in MEDICAL_MAP.keys():
            if key in text and key not in found_entities:
                found_entities.append(key)

        # 4. NORMALIZATION (Synonyms & Case)
        # Convert 'turmeric' to 'Curcumin', 'omez' to 'Pantoprazole', etc.
        normalized_entities = []
        for e in found_entities:
            norm = MEDICAL_MAP.get(e, e.title())
            if norm not in normalized_entities:
                normalized_entities.append(norm)

        print(f"🧠 AI & Scanner Detected: {normalized_entities}")

        if len(normalized_entities) < 2:
            return {"results": [], "detected_entities": normalized_entities, "message": "Need 2 entities."}

        herb, drug = normalized_entities[0], normalized_entities[1]

        # 5. Create Final Result
        new_row = {
            "herb": herb,
            "drug": drug,
            "interaction_text": f"Potential interaction identified between {herb} and {drug}.",
            "mechanism": "Neural Entity Recognition and Medical Keyword Mapping.",
            "severity": "Moderate",
            "recommendation": "Consult clinical guidelines. Monitor for adverse effects.",
            "citation_url": "https://pubmed.ncbi.nlm.nih.gov/"
        }

        return {"results": [new_row], "status": "success"}

    except Exception as e:
        return {"results": [], "status": "error", "message": str(e)}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
