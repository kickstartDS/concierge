from flask import Blueprint
from flask import redirect
from flask import render_template
from flask import request
from flask import url_for
from flask_login import current_user
from flask_login import login_required
from flask_login import login_user
from flask_login import logout_user
from werkzeug.urls import url_parse
from sentence_transformers import SentenceTransformer

from app.extensions import db
from app.forms import LoginForm
from app.forms import RegistrationForm
from app.models import User

import os
from dtale.app import build_app
from dtale.views import startup

from dotenv import load_dotenv
from pgvector.psycopg import register_vector
import psycopg
import os
import pandas as pd

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
    sql = (
        "SELECT id, created_at, question, prompt, prompt_length, answer FROM questions;"
    )
    df = pd.read_sql_query(sql, conn)


server_bp = Blueprint(
    "app", __name__, template_folder=os.path.abspath("./app/templates")
)

bi_encoder = SentenceTransformer("msmarco-distilbert-cos-v5")
bi_encoder.max_seq_length = 256


# duplicated to have app.index existing, even if it's never called,
# because it is overwritten by dtale `/` route
@server_bp.route("/", methods=["GET"])
def index():
    return 'Hi there, load data using <a href="/create-df">create-df</a>'


@server_bp.route("/", methods=["POST"])
def embedding():
    request_data = request.get_json()
    question_embedding = bi_encoder.encode(
        request_data["question"], convert_to_tensor=True
    )
    question_embedding = question_embedding.cpu()
    return {"embedding": question_embedding.detach().numpy().tolist()}


@server_bp.route("/create-df")
@login_required
def create_df():
    instance = startup(data=df, ignore_duplicate=True)
    return redirect(f"/dtale/main/{instance._data_id}", code=302)


@server_bp.route("/login/", methods=["GET", "POST"])
def login():
    if current_user.is_authenticated:
        return redirect(url_for("app.index"))

    form = LoginForm()
    if form.validate_on_submit():
        user = User.query.filter_by(username=form.username.data).first()
        if user is None or not user.check_password(form.password.data):
            error = "Invalid username or password"
            return render_template("login.html", form=form, error=error)

        login_user(user, remember=form.remember_me.data)
        next_page = request.args.get("next")
        if not next_page or url_parse(next_page).netloc != "":
            next_page = url_for("app.index")
        return redirect(next_page)

    return render_template("login.html", title="Sign In", form=form)


@server_bp.route("/logout/")
@login_required
def logout():
    logout_user()

    return redirect(url_for("app.index"))


@server_bp.route("/register/", methods=["GET", "POST"])
def register():
    if current_user.is_authenticated:
        return redirect(url_for("app.index"))

    form = RegistrationForm()
    if form.validate_on_submit():
        user = User(username=form.username.data)
        user.set_password(form.password.data)
        db.session.add(user)
        db.session.commit()

        return redirect(url_for("app.login"))

    return render_template("register.html", title="Register", form=form)
