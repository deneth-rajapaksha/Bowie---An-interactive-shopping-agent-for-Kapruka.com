# Bowie Modal vLLM

This deploys an OpenAI-compatible vLLM server on Modal for BowieAgent.

## 1. Install and authenticate Modal

```powershell
pip install modal
modal setup
```

## 2. Deploy

```powershell
modal deploy modal/bowie_vllm.py
```

Modal prints a URL like:

```text
https://<workspace>--bowie-vllm-serve.modal.run
```

## 3. Backend env

Set these in the root backend `.env`:

```env
BOWIE_AI_PROVIDER=modal
MODAL_OPENAI_BASE_URL=https://<workspace>--bowie-vllm-serve.modal.run/v1
MODAL_API_KEY=modal-local-dev
MODAL_FAST_MODEL=bowie-modal
MODAL_SMART_MODEL=bowie-modal
```

Restart the backend after changing envs.

You can also set `MODAL_OPENAI_BASE_URL` without `/v1`; the backend normalizes
it. To check the deployed server directly:

```powershell
Invoke-WebRequest -UseBasicParsing `
  -Uri "https://<workspace>--bowie-vllm-serve.modal.run/v1/models"
```

## Notes

- The first request may take a while while Modal starts the container and loads the model.
- The frontend shows a "Starting the shopping model" indicator after a short wait.
- `Qwen/Qwen2.5-7B-Instruct` is non-gated and small enough for a modest GPU.
- `transformers==4.45.2` is pinned because newer Transformers builds can break
  `vllm==0.6.6.post1` with `Qwen2Tokenizer has no attribute all_special_tokens_extended`.
