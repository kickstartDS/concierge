import psycopg
import os
import plotly.graph_objects as go
import pandas as pd

import dash_bootstrap_components as dbc

from dash import dcc
from dash import html

from dotenv import load_dotenv
from pgvector.psycopg import register_vector
from plotly.subplots import make_subplots

load_dotenv()

conn_string = (
    "dbname=postgres user=postgres password="
    + os.getenv("DB_PASS")
    + " host=db.pzdzoelitkqizxopmwfg.supabase.co port=5432"
)
conn = psycopg.connect(conn_string)
conn.autocommit = True
conn.execute("CREATE EXTENSION IF NOT EXISTS vector")
register_vector(conn)

with psycopg.connect(
    "dbname=postgres user=postgres password="
    + os.getenv("DB_PASS")
    + " host=db.pzdzoelitkqizxopmwfg.supabase.co port=5432"
) as conn:
    sql = """
        SELECT question, t.cnt
        FROM (
        SELECT DISTINCT(question),
               COUNT(*) OVER (PARTITION BY question) AS cnt
        FROM questions WHERE created_at >= '2023-05-02'::date) AS t
        WHERE t.cnt > 10;"""
    df_def_questions = pd.read_sql_query(sql, conn)
    pie_def_questions = go.Figure(
        data=go.Pie(values=df_def_questions["cnt"], labels=df_def_questions["question"])
    )
    pie_def_questions.update_layout(
        legend=dict(x=0, y=-20, xref="container", yref="container")
    )

    sql = "SELECT created_at, 1 as count FROM questions WHERE created_at >= '2023-05-02'::date;"
    df_question_cumulated_by_date = pd.read_sql_query(sql, conn)
    histogram_question_cumulated_by_date = go.Figure(
        data=go.Histogram(
            x=df_question_cumulated_by_date["created_at"],
            y=df_question_cumulated_by_date["count"],
            cumulative_enabled=True,
            nbinsx=100,
        )
    )

layout = html.Div(
    [
        dbc.Row([dbc.Col(html.H1("Concierge dashboard")), dbc.Col([])]),
        dbc.Row(
            [
                dbc.Col(
                    [
                        html.H2("Distribution default questions"),
                        dcc.Graph(id="graph_def_questions", figure=pie_def_questions),
                    ]
                ),
                dbc.Col(
                    [
                        html.H2("# of asked questions over time"),
                        dcc.Graph(
                            id="graph_question_cumulated_by_date",
                            figure=histogram_question_cumulated_by_date,
                        ),
                    ]
                ),
            ]
        ),
        dbc.Row([dbc.Col([]), dbc.Col([])]),
    ]
)
