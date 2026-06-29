import os

from flask import Flask, jsonify, request


app = Flask(__name__)


@app.get("/")
def hello():
    name = request.args.get("name", "").strip() or "World"
    return jsonify({"message": f"Hello {name}!"})


if __name__ == "__main__":
    port = int(os.environ.get("SERVER_PORT", "3000"))
    app.run(host="0.0.0.0", port=port)
