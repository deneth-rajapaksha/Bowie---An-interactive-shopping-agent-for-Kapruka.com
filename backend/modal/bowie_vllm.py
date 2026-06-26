import modal

MODEL_NAME = "Qwen/Qwen2.5-7B-Instruct"
SERVED_MODEL_NAME = "bowie-modal"
VLLM_PORT = 8000
MINUTES = 60

image = (
    modal.Image.from_registry("nvidia/cuda:12.4.1-devel-ubuntu22.04", add_python="3.11")
    .entrypoint([])
    .uv_pip_install(
        "vllm==0.6.6.post1",
        "transformers==4.45.2",
        "huggingface_hub[hf_transfer]==0.26.5",
    )
    .env(
        {
            "HF_XET_HIGH_PERFORMANCE": "1",
            "VLLM_LOG_STATS_INTERVAL": "30",
        }
    )
)

app = modal.App("bowie-vllm")
hf_cache = modal.Volume.from_name("bowie-hf-cache", create_if_missing=True)
vllm_cache = modal.Volume.from_name("bowie-vllm-cache", create_if_missing=True)


@app.function(
    image=image,
    gpu="A10G",
    timeout=10 * MINUTES,
    scaledown_window=10 * MINUTES,
    volumes={
        "/root/.cache/huggingface": hf_cache,
        "/root/.cache/vllm": vllm_cache,
    },
)
@modal.concurrent(max_inputs=16)
@modal.web_server(port=VLLM_PORT, startup_timeout=10 * MINUTES)
def serve():
    import subprocess

    cmd = [
        "vllm",
        "serve",
        MODEL_NAME,
        "--served-model-name",
        SERVED_MODEL_NAME,
        "--host",
        "0.0.0.0",
        "--port",
        str(VLLM_PORT),
        "--max-model-len",
        "4096",
        "--gpu-memory-utilization",
        "0.9",
        "--enable-auto-tool-choice",
        "--tool-call-parser",
        "hermes",
        "--enforce-eager",
    ]

    subprocess.Popen(cmd)


@app.local_entrypoint()
def main():
    print("Deploy with: modal deploy modal/bowie_vllm.py")
    print("After deploy, set backend MODAL_OPENAI_BASE_URL to:")
    print("https://<workspace>--bowie-vllm-serve.modal.run/v1")
