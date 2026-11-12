FROM python:3.12-slim

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY iai_duel.py .
COPY assets ./assets

# Web サーバーとして起動（Hugging Face Spaces は 7860 番を公開）
ENV FLET_FORCE_WEB_SERVER=true
ENV FLET_SERVER_PORT=7860
EXPOSE 7860

CMD ["python", "iai_duel.py"]
