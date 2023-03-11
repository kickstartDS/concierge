from sentence_transformers import SentenceTransformer
from flask import Flask, request

app = Flask(__name__)

bi_encoder = SentenceTransformer('multi-qa-mpnet-base-dot-v1')
bi_encoder.max_seq_length = 256

@app.route('/', methods=['POST'])
def embedding():
    request_data = request.get_json()
    question_embedding = bi_encoder.encode(request_data['question'], convert_to_tensor=True)
    question_embedding = question_embedding.cpu()
    return { "embedding": question_embedding.detach().numpy().tolist() }