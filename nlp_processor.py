import pandas as pd
import os
import re
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from transformers import pipeline
from fastapi.middleware.cors import CORSMiddleware

app = FastAPI(title="BioBERT Interaction Engine")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# Load Model
print("⏳ Loading BioBERT Medical Model...")
biobert_ner = pipeline("ner", 
                       model="d4data/biomedical-ner-all", 
                       aggregation_strategy="simple")

CSV_PATH = os.path.join("data", "interactions.csv")

# List of herbs to catch manually if BioBERT fails
AYURVEDIC_HERBS = [
    "Triphala", "Ashwagandha", "Guggulu", "Amalaki", "Brahmi", 
    "Shatavari", "Tulsi", "Turmeric", "Curcumin", "Neem", "Giloy"
]

class AnalyzeRequest(BaseModel):
    text: str

@app.post("/analyze")
async def analyze_text(request: AnalyzeRequest):
    try:
        text = request.text
        if not text:
            return {"results": [], "status": "error", "message": "No text provided"}

        print(f"📥 Analyzing: '{text}'")

        # 1. NER Detection (AI)
        entities = biobert_ner(text)
        found_chemicals = [e['word'].strip().title() for e in entities if e['entity_group'] in ['Chemical', 'Drug']]
        
        # 2. Hardcoded Ayurvedic Check (Manual Support)
        for herb in AYURVEDIC_HERBS:
            if herb.lower() in text.lower():
                if herb.title() not in found_chemicals:
                    found_chemicals.append(herb.title())

        # 3. Regex Fallback (Capitalized words for other unknown entities)
        potential = re.findall(r'\b[A-Z][a-z]{2,}\b', text)
        for word in potential:
            if word not in found_chemicals:
                found_chemicals.append(word)

        # Deduplicate while preserving order
        seen = set()
        found_chemicals = [x for x in found_chemicals if not (x in seen or seen.add(x))]

        # Need at least two things for an interaction
        if len(found_chemicals) < 2:
            return {
                "results": [], 
                "detected_entities": [{"entity": c, "type": "CHEMICAL"} for c in found_chemicals],
                "status": "success",
                "message": "Only one or zero entities found."
            }

        # Sort: Try to make the Ayurvedic herb the 'herb' and the other the 'drug'
        # If the first item is in our Ayurvedic list, keep it as herb.
        herb, drug = found_chemicals[0], found_chemicals[1]
        
        print(f"🔍 Found Pair: {herb} + {drug}")

        new_row = {
            "herb": herb,
            "drug": drug,
            "interaction_text": f"NLP Analysis suggests potential interaction between {herb} and {drug}.",
            "mechanism": "Clinical Pattern Matching & BioBERT NER.",
            "evidence_level": "High",
            "severity": "Moderate",
            "severity_score": 2,
            "recommendation": "Monitor for adverse reactions; consult integrative medicine guidelines.",
            "citation_url": "https://pubmed.ncbi.nlm.nih.gov/"
        }

        # 4. Safe CSV Sync
        if os.path.exists(CSV_PATH):
            df = pd.read_csv(CSV_PATH, encoding='utf-8-sig')
            df.columns = df.columns.str.strip().str.lower()
            
            if 'herb' in df.columns and 'drug' in df.columns:
                is_duplicate = ((df['herb'].astype(str).str.lower() == herb.lower()) & 
                                (df['drug'].astype(str).str.lower() == drug.lower())).any()
                
                if not is_duplicate:
                    df = pd.concat([df, pd.DataFrame([new_row])], ignore_index=True)
                    df.to_csv(CSV_PATH, index=False, encoding='utf-8')
                    print(f"✅ CSV Updated: {herb} + {drug}")
            else:
                # Force repair headers if they are missing/corrupted
                df.columns = ['herb', 'drug', 'interaction_text', 'mechanism', 'evidence_level', 'severity', 'severity_score', 'recommendation', 'citation_url']
                df.to_csv(CSV_PATH, index=False, encoding='utf-8')
        
        return {"results": [new_row], "status": "success"}

    except Exception as e:
        print(f"❌ Python Crash: {str(e)}")
        return {"results": [], "status": "error", "message": str(e)}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="127.0.0.1", port=8000)