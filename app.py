from sentence_transformers import SentenceTransformer
from flask import Flask, request
from flask_cors import CORS

app = Flask(__name__)
CORS(app)
# TODO re-add this, should restrict origins here
# cors = CORS(app, resources={r"/*": {"origins": "*"}})

bi_encoder = SentenceTransformer('msmarco-distilbert-cos-v5')
bi_encoder.max_seq_length = 256

@app.route('/', methods=['POST'])
def embedding():
    request_data = request.get_json()
    question_embedding = bi_encoder.encode(request_data['question'], convert_to_tensor=True)
    question_embedding = question_embedding.cpu()
    return { "embedding": question_embedding.detach().numpy().tolist() }