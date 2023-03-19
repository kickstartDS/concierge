# Run this app with `python app.py` and
# visit http://127.0.0.1:8050/ in your web browser.

from dash import Dash, html, dcc
from dotenv import load_dotenv
from pgvector.psycopg import register_vector
from umap import UMAP
import psycopg
import os
import plotly.express as px
import pandas as pd

load_dotenv()

conn_string = "dbname=postgres user=postgres password=" + os.getenv('DB_PASS') + " host=db.pzdzoelitkqizxopmwfg.supabase.co port=5432"
conn = psycopg.connect(conn_string)
conn.autocommit = True
conn.execute('CREATE EXTENSION IF NOT EXISTS vector')
register_vector(conn)

with psycopg.connect("dbname=postgres user=postgres password=" + os.getenv('DB_PASS') + " host=db.pzdzoelitkqizxopmwfg.supabase.co port=5432") as conn:
    sql = "SELECT page_url, page_title, tokens, embedding FROM sections TABLESAMPLE SYSTEM ((1000 * 100) / 5100000.0);"
    df = pd.read_sql_query(sql, conn)

features = df.loc[:, :'page_url']
umap_3d = UMAP(n_components=3, init='random', random_state=0)
proj_3d = umap_3d.fit_transform(features)
umapFig = px.scatter_3d(
    proj_3d, x=0, y=1, z=2,
    color=df.page_url, labels={'color': 'page_url'}
)
umapFig.update_traces(marker_size=5)

print(dat)

#hits = conn.execute('SELECT * FROM sections ORDER BY embedding <-> %s LIMIT ' + str(top_k), (question_embedding.detach().numpy(),)).fetchall()

app = Dash(__name__)

# assume you have a "long-form" data frame
# see https://plotly.com/python/px-arguments/ for more options
df = pd.DataFrame({
    "Fruit": ["Apples", "Oranges", "Bananas", "Apples", "Oranges", "Bananas"],
    "Amount": [4, 1, 2, 2, 4, 5],
    "City": ["SF", "SF", "SF", "Montreal", "Montreal", "Montreal"]
})

fig = px.bar(df, x="Fruit", y="Amount", color="City", barmode="group")

app.layout = html.Div(children=[
    html.H1(children='Hello Dash'),

    html.Div(children='''
        Dash: A web application framework for your data.
    '''),

    dcc.Graph(
        id='example-graph',
        figure=fig
    ),

    html.Div(children='''
        UMAP: Visualization of embeddings.
    '''),

    dcc.Graph(
        id='umap',
        figure=umapFig
    )
])

if __name__ == '__main__':
    app.run_server(debug=True)