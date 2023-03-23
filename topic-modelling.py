import logging
import torch
import pickle
import jsonlines
from sentence_transformers import SentenceTransformer, LoggingHandler
from bertopic import BERTopic

logging.basicConfig(
    format='%(asctime)s - %(message)s',
    datefmt='%Y-%m-%d %H:%M:%S',
    level=logging.INFO,
    handlers=[LoggingHandler()]
)

def get_section_content(section):
    return section['content'].replace('\n', ' ').strip()

if not torch.cuda.is_available():
    print("Warning: No GPU found. Please add GPU to your notebook.")
    
print('Creating SBert knowledge base.')    

sections = []
with jsonlines.open('notebooks/pages-all.jsonl', 'r') as pages:
    for page in pages:
        for page_section in page['sections']:
            section = dict()
            section['page'] = dict()
            section['page']['url'] = page['url']
            section['page']['title'] = page['title']
            section['page']['summary'] = page['summaries']['sbert']
            section['content'] = page_section['content']['raw']
            section['tokens'] = page_section['tokens']
            sections.append(section)

passages = []
passages.extend(map(get_section_content, sections))

print('Passages:', len(passages))

if __name__ == '__main__':
    bi_encoder = SentenceTransformer('msmarco-distilbert-cos-v5')
    bi_encoder.max_seq_length = 350
    pool = bi_encoder.start_multi_process_pool()

    corpus_embeddings = bi_encoder.encode_multi_process(passages, pool)

    print('Corpus embeddings created.')
    print('Corpus embedding size:', corpus_embeddings.shape)

    bi_encoder.stop_multi_process_pool(pool)

    with open("page-embeddings.pkl", "wb") as writer:
        pickle.dump({'passages': passages, 'embeddings': corpus_embeddings}, writer)
