# RunPod Serverless 部署指南

> 基于 RunPod 官方 ComfyUI Docker 镜像构建 Wan2.2 视频生成 Serverless 端点

## 📋 目录

- [架构概览](#架构概览)
- [前置准备](#前置准备)
- [模型文件清单](#模型文件清单)
- [Network Volume 设置](#network-volume-设置)
- [Docker 镜像构建](#docker-镜像构建)
- [启动脚本配置](#启动脚本配置)
- [Handler 实现](#handler-实现)
- [创建 Serverless Endpoint](#创建-serverless-endpoint)
- [前端调用方式](#前端调用方式)
- [成本估算](#成本估算)

---

## 架构概览

```
┌─────────────┐
│   用户浏览器   │
└──────┬──────┘
       │ HTTP Request (workflow + images)
       ↓
┌─────────────────────────────────────┐
│  RunPod Serverless Endpoint         │
│  ┌───────────────────────────────┐  │
│  │  Docker Container             │  │
│  │  ├─ ComfyUI (base)           │  │
│  │  ├─ Custom Nodes (自动安装)   │  │
│  │  ├─ Models (从 Volume 挂载)  │  │
│  │  └─ RunPod Handler           │  │
│  └───────────────────────────────┘  │
│         ↓                            │
│  ┌───────────────────────────────┐  │
│  │  Network Volume               │  │
│  │  /runpod-volume/models/       │  │
│  │  ├─ unet/ (~28GB)            │  │
│  │  ├─ clip/ (~20GB)            │  │
│  │  ├─ vae/ (~335MB)            │  │
│  │  ├─ loras/Wan/ (~1.5GB)      │  │
│  │  └─ upscale_models/ (~17MB)  │  │
│  └───────────────────────────────┘  │
└─────────────────────────────────────┘
       │ HTTP Response (video URL)
       ↓
┌─────────────┐
│   用户浏览器   │
└─────────────┘
```

---

## 前置准备

### 1. 已完成的准备
- ✅ RunPod 账号
- ✅ `runpodctl` 已安装并配置 API Key
- ✅ Docker Hub 账号（用于推送自定义镜像）

### 2. 需要准备的
- [ ] 下载并整理所有模型文件
- [ ] 创建 RunPod Network Volume
- [ ] 上传模型到 Network Volume
- [ ] 构建自定义 Docker 镜像
- [ ] 创建 Serverless Endpoint

---

## 模型文件清单

从你的 `ComfyUI/WanSE.json` workflow 分析，需要以下模型：

### 目录结构
```
models/
├── unet/
│   ├── wan2.2_i2v_A14b_high_noise_scaled_fp8_e4m3_lightx2v_4step_comfyui_1030.safetensors  (~14GB)
│   └── wan2.2_i2v_A14b_low_noise_scaled_fp8_e4m3_lightx2v_4step_comfyui.safetensors        (~14GB)
│
├── loras/Wan/
│   ├── lightx2v_I2V_14B_480p_cfg_step_distill_rank256_bf16.safetensors                     (~512MB)
│   ├── Wan2.2-Fun-A14B-InP-low-noise-HPS2.1.safetensors                                    (~512MB)
│   └── Wan2.2-Fun-A14B-InP-high-noise-MPS.safetensors                                      (~512MB)
│
├── vae/
│   └── wan_2.1_vae.safetensors                                                              (~335MB)
│
├── clip/
│   └── umt5_xxl_fp16.safetensors                                                            (~20GB)
│
└── upscale_models/
    └── 2x-AnimeSharpV2_RPLKSR_Sharp.pth                                                     (~17MB)
```

**总存储需求：约 50-60GB**

---

## Network Volume 设置

### 1. 创建 Network Volume

```bash
# 创建 100GB 的 Network Volume（建议美国区域延迟最低）
runpodctl create volume comfyui-wan-models --size 100 --region US

# 记录返回的 volume_id，例如：
# {
#   "id": "abc123def456",
#   "name": "comfyui-wan-models",
#   ...
# }
```

### 2. 上传模型到 Volume

**方法 A：通过临时 Pod 上传（推荐用于大文件）**

```bash
# 1. 创建临时 Pod（GPU Pod 启动快）
runpodctl create pod \
  --name model-upload-temp \
  --volumeId abc123def456 \
  --image runpod/pytorch:latest \
  --gpu "NVIDIA RTX 4090" \
  --volumeMountPath /runpod-volume

# 2. 等待 Pod 启动（约 1-2 分钟）
# 查看 Pod 状态
runpodctl get pod model-upload-temp

# 3. 上传模型文件（假设本地模型在 ./local-models/ 目录）
# 注意：大文件上传可能需要很长时间
runpodctl send model-upload-temp ./local-models/unet/ /runpod-volume/models/unet/
runpodctl send model-upload-temp ./local-models/loras/ /runpod-volume/models/loras/
runpodctl send model-upload-temp ./local-models/vae/ /runpod-volume/models/vae/
runpodctl send model-upload-temp ./local-models/clip/ /runpod-volume/models/clip/
runpodctl send model-upload-temp ./local-models/upscale_models/ /runpod-volume/models/upscale_models/

# 4. 验证上传（通过 SSH 连接到 Pod）
runpodctl ssh model-upload-temp
# 在 Pod 内执行：
ls -lh /runpod-volume/models/unet/
ls -lh /runpod-volume/models/clip/
exit

# 5. 删除临时 Pod
runpodctl remove pod model-upload-temp
```

**方法 B：通过 RunPod Web 界面上传（适合小文件）**

1. 登录 RunPod Web Console
2. 创建临时 Pod 并挂载 Volume
3. 使用 Web Terminal 或 SSH 上传

---

## Docker 镜像构建

### 基于 RunPod 官方 ComfyUI 镜像

**目录结构：**
```
runpod-docker/
├── Dockerfile
├── start.sh          # 启动脚本（安装节点 + 挂载模型）
└── handler.py        # RunPod Serverless Handler
```

### Dockerfile

```dockerfile
# 基于 RunPod 官方 ComfyUI 镜像
FROM runpod/worker-comfy:latest

# 设置工作目录
WORKDIR /comfyui

# 安装 RunPod SDK（如果镜像中没有）
RUN pip install runpod requests

# 复制启动脚本和 handler
COPY start.sh /comfyui/start.sh
COPY handler.py /comfyui/handler.py

# 设置执行权限
RUN chmod +x /comfyui/start.sh

# 设置启动命令
CMD ["/bin/bash", "/comfyui/start.sh"]
```

---

## 启动脚本配置

### `start.sh` - 自动安装节点和挂载模型

```bash
#!/bin/bash
set -e

echo "=========================================="
echo "🚀 ComfyUI Wan2.2 Serverless Startup"
echo "=========================================="

# ============================================
# 步骤 1: 安装自定义节点
# ============================================
echo ""
echo "📦 [1/3] Installing Custom Nodes..."

cd /comfyui/custom_nodes

# VideoHelperSuite (用于 VHS_VideoCombine 节点)
if [ ! -d "ComfyUI-VideoHelperSuite" ]; then
    echo "  → Installing ComfyUI-VideoHelperSuite..."
    git clone https://github.com/Kosinkadink/ComfyUI-VideoHelperSuite.git
    cd ComfyUI-VideoHelperSuite
    pip install -r requirements.txt --no-cache-dir
    cd ..
    echo "  ✅ VideoHelperSuite installed"
else
    echo "  ✅ VideoHelperSuite already exists"
fi

# ComfyUI-KJNodes (用于 ImageResizeKJv2, SageAttention 节点)
if [ ! -d "ComfyUI-KJNodes" ]; then
    echo "  → Installing ComfyUI-KJNodes..."
    git clone https://github.com/kijai/ComfyUI-KJNodes.git
    cd ComfyUI-KJNodes
    pip install -r requirements.txt --no-cache-dir
    cd ..
    echo "  ✅ KJNodes installed"
else
    echo "  ✅ KJNodes already exists"
fi

# 如果有其他自定义节点，在这里添加
# 例如：WanFirstLastFrameToVideo 节点
# if [ ! -d "ComfyUI-Wan-Nodes" ]; then
#     echo "  → Installing Wan Custom Nodes..."
#     git clone https://github.com/YOUR_REPO/ComfyUI-Wan-Nodes.git
#     cd ComfyUI-Wan-Nodes
#     pip install -r requirements.txt --no-cache-dir
#     cd ..
#     echo "  ✅ Wan Nodes installed"
# fi

echo "✅ All custom nodes ready"

# ============================================
# 步骤 2: 挂载 Network Volume 模型
# ============================================
echo ""
echo "🔗 [2/3] Linking Models from Network Volume..."

if [ -d "/runpod-volume/models" ]; then
    echo "  ✅ Network Volume detected at /runpod-volume"

    # 备份原有 models 目录（如果需要）
    if [ -d "/comfyui/models" ] && [ ! -L "/comfyui/models" ]; then
        echo "  → Backing up original models directory..."
        mv /comfyui/models /comfyui/models.backup
    fi

    # 删除已存在的符号链接
    if [ -L "/comfyui/models" ]; then
        rm /comfyui/models
    fi

    # 创建符号链接
    ln -sf /runpod-volume/models /comfyui/models

    echo "  ✅ Models linked: /runpod-volume/models -> /comfyui/models"

    # 验证关键模型文件是否存在
    echo ""
    echo "  📋 Verifying model files..."

    if [ -d "/comfyui/models/unet" ]; then
        echo "    ✅ UNET models: $(ls /comfyui/models/unet | wc -l) files"
    else
        echo "    ⚠️  UNET models directory not found"
    fi

    if [ -d "/comfyui/models/clip" ]; then
        echo "    ✅ CLIP models: $(ls /comfyui/models/clip | wc -l) files"
    else
        echo "    ⚠️  CLIP models directory not found"
    fi

    if [ -d "/comfyui/models/vae" ]; then
        echo "    ✅ VAE models: $(ls /comfyui/models/vae | wc -l) files"
    else
        echo "    ⚠️  VAE models directory not found"
    fi

    if [ -d "/comfyui/models/loras/Wan" ]; then
        echo "    ✅ LoRA models: $(ls /comfyui/models/loras/Wan | wc -l) files"
    else
        echo "    ⚠️  LoRA models directory not found"
    fi

else
    echo "  ❌ ERROR: Network Volume not mounted at /runpod-volume"
    echo "  Please ensure volume is attached when creating the endpoint"
    echo "  Use: --volumeId YOUR_VOLUME_ID --volumeMountPath /runpod-volume"
    exit 1
fi

# ============================================
# 步骤 3: 启动 ComfyUI + RunPod Handler
# ============================================
echo ""
echo "🎬 [3/3] Starting RunPod Serverless Handler..."
cd /comfyui

# 启动 handler（会在内部启动 ComfyUI）
python handler.py
```

---

## Handler 实现

### `handler.py` - RunPod Serverless 处理程序

```python
"""
RunPod Serverless Handler for ComfyUI Wan2.2 Video Generation
"""

import runpod
import json
import requests
import base64
import time
import os
import subprocess
from pathlib import Path

# ComfyUI 本地地址
COMFYUI_URL = "http://127.0.0.1:8188"
COMFYUI_DIR = "/comfyui"

def start_comfyui():
    """后台启动 ComfyUI 服务"""
    print("🔧 Starting ComfyUI server...")

    # 启动 ComfyUI（后台运行）
    process = subprocess.Popen(
        ["python", "main.py", "--listen", "127.0.0.1", "--port", "8188"],
        cwd=COMFYUI_DIR,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE
    )

    # 等待 ComfyUI 启动（最多 60 秒）
    for i in range(60):
        try:
            response = requests.get(f"{COMFYUI_URL}/system_stats", timeout=1)
            if response.status_code == 200:
                print(f"✅ ComfyUI ready after {i+1} seconds")
                return True
        except requests.exceptions.RequestException:
            time.sleep(1)

    print("❌ ComfyUI failed to start within 60 seconds")
    return False


def upload_image_to_comfyui(base64_image, filename):
    """
    上传 base64 图片到 ComfyUI

    Args:
        base64_image: base64 编码的图片（可能包含 data:image/png;base64, 前缀）
        filename: 文件名

    Returns:
        str: 上传后的文件名
    """
    # 移除 data URL 前缀（如果有）
    if ',' in base64_image:
        base64_image = base64_image.split(',', 1)[1]

    # 解码 base64
    image_data = base64.b64decode(base64_image)

    # 上传到 ComfyUI
    files = {'image': (filename, image_data, 'image/png')}
    data = {'overwrite': 'true'}

    response = requests.post(f"{COMFYUI_URL}/upload/image", files=files, data=data)

    if response.status_code != 200:
        raise Exception(f"Failed to upload image: {response.text}")

    result = response.json()
    uploaded_name = result.get('name', filename)

    print(f"  ✅ Uploaded: {uploaded_name}")
    return uploaded_name


def queue_workflow(workflow):
    """
    提交 workflow 到 ComfyUI 队列

    Args:
        workflow: ComfyUI workflow JSON

    Returns:
        str: prompt_id
    """
    response = requests.post(
        f"{COMFYUI_URL}/prompt",
        headers={'Content-Type': 'application/json'},
        json={"prompt": workflow}
    )

    if response.status_code != 200:
        raise Exception(f"Failed to queue workflow: {response.text}")

    result = response.json()
    prompt_id = result['prompt_id']

    print(f"  ✅ Queued with prompt_id: {prompt_id}")
    return prompt_id


def wait_for_completion(prompt_id, timeout=600):
    """
    等待 ComfyUI 完成生成

    Args:
        prompt_id: ComfyUI prompt ID
        timeout: 超时时间（秒）

    Returns:
        tuple: (filename, subfolder)
    """
    start_time = time.time()
    last_status = None

    while time.time() - start_time < timeout:
        # 检查队列状态
        try:
            queue_response = requests.get(f"{COMFYUI_URL}/queue")
            queue_data = queue_response.json()

            # 检查是否还在队列中
            queue_running = queue_data.get('queue_running', [])
            queue_pending = queue_data.get('queue_pending', [])

            in_queue = any(
                item[1] == prompt_id
                for item in queue_running + queue_pending
            )

            if in_queue:
                current_status = "running" if any(item[1] == prompt_id for item in queue_running) else "pending"
                if current_status != last_status:
                    print(f"  ⏳ Status: {current_status}")
                    last_status = current_status
            else:
                # 不在队列中，检查历史记录
                history_response = requests.get(f"{COMFYUI_URL}/history/{prompt_id}")

                if history_response.status_code == 200:
                    history_data = history_response.json()

                    if prompt_id in history_data:
                        outputs = history_data[prompt_id].get('outputs', {})

                        # 查找视频输出节点（通常是 SaveVideo 节点）
                        for node_id, output in outputs.items():
                            if 'gifs' in output and len(output['gifs']) > 0:
                                video_info = output['gifs'][0]
                                filename = video_info['filename']
                                subfolder = video_info.get('subfolder', '')
                                print(f"  ✅ Video generated: {filename}")
                                return filename, subfolder

                        # 如果没找到视频，可能是错误
                        status = history_data[prompt_id].get('status', {})
                        if status.get('status_str') == 'error':
                            messages = status.get('messages', [])
                            error_msg = '\n'.join([str(m) for m in messages])
                            raise Exception(f"ComfyUI generation failed: {error_msg}")

        except requests.exceptions.RequestException as e:
            print(f"  ⚠️  Request error: {e}")

        time.sleep(3)

    raise TimeoutError(f"Video generation timeout after {timeout} seconds")


def get_video_content(filename, subfolder):
    """
    从 ComfyUI 下载视频内容

    Args:
        filename: 视频文件名
        subfolder: 子目录

    Returns:
        bytes: 视频二进制内容
    """
    params = {
        'filename': filename,
        'type': 'output'
    }
    if subfolder:
        params['subfolder'] = subfolder

    response = requests.get(f"{COMFYUI_URL}/view", params=params)

    if response.status_code != 200:
        raise Exception(f"Failed to download video: {response.text}")

    return response.content


def handler(event):
    """
    RunPod Serverless Handler 主函数

    输入格式：
    {
        "input": {
            "workflow": {...},              # ComfyUI workflow JSON
            "start_image": "base64...",     # 起始帧 base64
            "end_image": "base64..." | null # 结束帧 base64（可选）
        }
    }

    输出格式：
    {
        "video_base64": "base64...",  # 生成的视频（base64 编码）
        "filename": "xxx.mp4",
        "prompt_id": "xxx"
    }
    """
    try:
        job_id = event.get('id', 'unknown')
        input_data = event.get("input", {})

        print(f"")
        print(f"========================================")
        print(f"📥 Received Job: {job_id}")
        print(f"========================================")

        # 解析输入参数
        workflow = input_data.get("workflow")
        start_image = input_data.get("start_image")
        end_image = input_data.get("end_image")

        if not workflow:
            return {"error": "Missing required parameter: workflow"}
        if not start_image:
            return {"error": "Missing required parameter: start_image"}

        print(f"📋 Parameters:")
        print(f"  - Has start_image: {bool(start_image)}")
        print(f"  - Has end_image: {bool(end_image)}")
        print(f"  - Workflow nodes: {len(workflow)}")

        # 1. 上传起始帧图片
        print(f"")
        print(f"📤 [1/4] Uploading images...")
        start_filename = upload_image_to_comfyui(
            start_image,
            f"start_{job_id}.png"
        )

        # 更新 workflow 中的起始帧（node 62）
        if "62" in workflow:
            workflow["62"]["inputs"]["image"] = start_filename

        # 2. 如果有结束帧，上传并配置双图模式
        if end_image:
            end_filename = upload_image_to_comfyui(
                end_image,
                f"end_{job_id}.png"
            )

            # 更新 workflow 中的结束帧（node 68）
            if "68" in workflow:
                workflow["68"]["inputs"]["image"] = end_filename
        else:
            # 单图模式：删除 end_image 连接
            print(f"  ℹ️  Single-image mode (last cut)")
            if "67" in workflow and "inputs" in workflow["67"]:
                workflow["67"]["inputs"].pop("end_image", None)
            workflow.pop("68", None)

        # 3. 提交 workflow 到 ComfyUI
        print(f"")
        print(f"🎬 [2/4] Queuing workflow...")
        prompt_id = queue_workflow(workflow)

        # 4. 等待生成完成
        print(f"")
        print(f"⏳ [3/4] Waiting for generation...")
        filename, subfolder = wait_for_completion(prompt_id, timeout=600)

        # 5. 下载视频
        print(f"")
        print(f"📥 [4/4] Downloading video...")
        video_content = get_video_content(filename, subfolder)
        video_base64 = base64.b64encode(video_content).decode('utf-8')

        print(f"")
        print(f"✅ Job completed successfully")
        print(f"  - Video size: {len(video_content) / 1024 / 1024:.2f} MB")
        print(f"  - Filename: {filename}")
        print(f"========================================")

        return {
            "video_base64": video_base64,
            "filename": filename,
            "prompt_id": prompt_id,
            "video_size_mb": len(video_content) / 1024 / 1024
        }

    except Exception as e:
        print(f"")
        print(f"❌ Error: {str(e)}")
        print(f"========================================")
        import traceback
        traceback.print_exc()

        return {
            "error": str(e),
            "traceback": traceback.format_exc()
        }


# ============================================
# 启动入口
# ============================================
if __name__ == "__main__":
    print("")
    print("========================================")
    print("🚀 RunPod Serverless Worker Starting...")
    print("========================================")

    # 启动 ComfyUI
    if start_comfyui():
        print("✅ ComfyUI is ready")
        print("🎧 Listening for jobs...")
        print("========================================")
        print("")

        # 启动 RunPod handler
        runpod.serverless.start({"handler": handler})
    else:
        print("❌ Failed to start ComfyUI")
        exit(1)
```

---

## 创建 Serverless Endpoint

### 1. 构建并推送 Docker 镜像

```bash
# 进入 docker 配置目录
cd runpod-docker

# 构建镜像
docker build -t your-dockerhub-username/comfyui-wan-serverless:latest .

# 推送到 Docker Hub
docker push your-dockerhub-username/comfyui-wan-serverless:latest
```

### 2. 使用 runpodctl 创建 Endpoint

```bash
runpodctl create endpoint \
  --name comfyui-wan-video-generator \
  --image your-dockerhub-username/comfyui-wan-serverless:latest \
  --volumeId YOUR_VOLUME_ID \
  --volumeMountPath /runpod-volume \
  --gpuType "NVIDIA RTX 4090" \
  --minWorkers 0 \
  --maxWorkers 3 \
  --idleTimeout 60 \
  --maxWait 300
```

**参数说明：**

| 参数 | 说明 |
|------|------|
| `--name` | Endpoint 名称 |
| `--image` | Docker 镜像地址 |
| `--volumeId` | Network Volume ID（包含模型）|
| `--volumeMountPath` | 固定为 `/runpod-volume` |
| `--gpuType` | GPU 类型（推荐 RTX 4090 或 A40）|
| `--minWorkers` | 最小 worker 数（0 = 无请求时关闭）|
| `--maxWorkers` | 最大 worker 数（并发能力）|
| `--idleTimeout` | 空闲多少秒后关闭 worker |
| `--maxWait` | 请求最多等待多少秒 |

### 3. 获取 Endpoint ID

创建成功后会返回 Endpoint ID，例如：
```json
{
  "id": "xyz789abc123",
  "name": "comfyui-wan-video-generator",
  ...
}
```

记录这个 ID，用于 API 调用。

---

## 前端调用方式

### 修改现有 `index.tsx` 中的 `generateVideoWithComfyUI` 函数

```typescript
// 在 settings 中添加 RunPod 配置
const [useRunPod, setUseRunPod] = useState(localStorage.getItem('useRunPod') === 'true');
const [runpodApiKey, setRunpodApiKey] = useState(localStorage.getItem('runpodApiKey') || '');
const [runpodEndpointId, setRunpodEndpointId] = useState(localStorage.getItem('runpodEndpointId') || '');

// 修改 generateVideoWithComfyUI 函数
const generateVideoWithComfyUI = async (
    startImage: string,
    endImage: string | null,
    videoPrompt: string
): Promise<string> => {
    const workflow = await loadWorkflow();

    // 更新 prompt
    workflow[promptNode].inputs.text = videoPrompt;

    // 生成随机种子
    const randomSeed1 = Math.floor(Math.random() * 1000000000000000);
    const randomSeed2 = Math.floor(Math.random() * 1000000000000000);

    if (workflow['57']) workflow['57'].inputs.noise_seed = randomSeed1;
    if (workflow['58']) workflow['58'].inputs.noise_seed = randomSeed2;

    // 更新分辨率
    Object.keys(workflow).forEach(nodeId => {
        const node = workflow[nodeId];
        if (node.inputs) {
            if (node.inputs.width === 512) node.inputs.width = videoResolution;
            if (node.inputs.height === 512) node.inputs.height = videoResolution;
        }
    });

    // ========================================
    // 判断使用本地 ComfyUI 还是 RunPod
    // ========================================
    if (useRunPod) {
        return await generateVideoWithRunPod(workflow, startImage, endImage);
    } else {
        return await generateVideoWithLocalComfyUI(workflow, startImage, endImage);
    }
};

// 新增：使用 RunPod Serverless
const generateVideoWithRunPod = async (
    workflow: any,
    startImage: string,
    endImage: string | null
): Promise<string> => {
    console.log('Using RunPod Serverless...');

    // 调用 RunPod API
    const response = await fetch(`https://api.runpod.ai/v2/${runpodEndpointId}/run`, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${runpodApiKey}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            input: {
                workflow: workflow,
                start_image: startImage,
                end_image: endImage
            }
        })
    });

    if (!response.ok) {
        throw new Error(`RunPod API 调用失败: ${response.statusText}`);
    }

    const result = await response.json();
    const jobId = result.id;

    console.log(`RunPod Job ID: ${jobId}`);

    // 轮询等待结果
    while (true) {
        await new Promise(resolve => setTimeout(resolve, 3000)); // 每 3 秒查询一次

        const statusResponse = await fetch(`https://api.runpod.ai/v2/${runpodEndpointId}/status/${jobId}`, {
            headers: {
                'Authorization': `Bearer ${runpodApiKey}`
            }
        });

        const statusData = await statusResponse.json();

        if (statusData.status === 'COMPLETED') {
            // 解码 base64 视频
            const videoBase64 = statusData.output.video_base64;
            const videoBlob = base64ToBlob(`data:video/mp4;base64,${videoBase64}`);
            const videoUrl = URL.createObjectURL(videoBlob);

            console.log('RunPod 视频生成完成');
            return videoUrl;
        } else if (statusData.status === 'FAILED') {
            throw new Error(`RunPod 生成失败: ${statusData.error}`);
        }

        console.log(`RunPod 状态: ${statusData.status}`);
    }
};

// 原有的本地 ComfyUI 逻辑（重构为独立函数）
const generateVideoWithLocalComfyUI = async (
    workflow: any,
    startImage: string,
    endImage: string | null
): Promise<string> => {
    console.log('Using Local ComfyUI...');

    // 配置 workflow（单图 vs 双图模式）
    if (endImage) {
        const startImageName = await uploadImageToComfyUI(startImage, `start_${Date.now()}.png`);
        const endImageName = await uploadImageToComfyUI(endImage, `end_${Date.now()}.png`);
        workflow[endFrameNode].inputs.image = startImageName;
        workflow[startFrameNode].inputs.image = endImageName;
    } else {
        const imageName = await uploadImageToComfyUI(startImage, `start_${Date.now()}.png`);
        workflow[endFrameNode].inputs.image = imageName;
        if (workflow['67']?.inputs) delete workflow['67'].inputs.end_image;
        if (workflow[startFrameNode]) delete workflow[startFrameNode];
    }

    // 提交 workflow
    const promptResponse = await fetch(`${comfyUIUrl}/prompt`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: workflow }),
    });

    if (!promptResponse.ok) {
        throw new Error(`ComfyUI 提示佇列失敗: ${promptResponse.statusText}`);
    }

    const promptResult = await promptResponse.json();
    const promptId = promptResult.prompt_id;

    // 等待完成
    const videoUrl = await waitForCompletion(promptId);
    return videoUrl;
};
```

### 在 Settings 界面添加 RunPod 配置

```tsx
<div style={{ marginTop: '20px', paddingTop: '20px', borderTop: '1px solid #333' }}>
    <h3>RunPod Serverless 设置</h3>

    <label>
        <input
            type="checkbox"
            checked={useRunPod}
            onChange={(e) => setUseRunPod(e.target.checked)}
        />
        使用 RunPod Serverless（而不是本地 ComfyUI）
    </label>

    {useRunPod && (
        <>
            <div>
                <label>RunPod API Key:</label>
                <input
                    type="password"
                    value={runpodApiKey}
                    onChange={(e) => setRunpodApiKey(e.target.value)}
                    placeholder="Enter your RunPod API Key"
                />
            </div>

            <div>
                <label>RunPod Endpoint ID:</label>
                <input
                    type="text"
                    value={runpodEndpointId}
                    onChange={(e) => setRunpodEndpointId(e.target.value)}
                    placeholder="xyz789abc123"
                />
            </div>
        </>
    )}
</div>
```

---

## 成本估算

### GPU 定价（以 RunPod 为例）

| GPU 型号 | 价格（$/小时）| 视频生成时间 | 单视频成本 |
|---------|-------------|------------|-----------|
| RTX 4090 | $0.69 | ~40秒 | ~$0.008 |
| A40 | $0.79 | ~35秒 | ~$0.008 |
| A100 | $1.89 | ~25秒 | ~$0.013 |

### 存储成本

| 资源 | 容量 | 价格 |
|------|------|------|
| Network Volume | 100GB | ~$10/月 |

### 示例场景

**每天生成 100 个视频：**
- 计算成本：100 × $0.008 = $0.80/天 = $24/月
- 存储成本：$10/月
- **总成本：约 $34/月**

**优势：**
- 无需购买 GPU 硬件
- 按使用量付费
- 自动扩展（支持并发）
- 无流量成本（RunPod 不收取 egress 费用）

---

## 故障排查

### 1. Volume 挂载问题

**症状：** 启动时报错 "Network Volume not mounted"

**解决：**
```bash
# 检查 endpoint 配置
runpodctl get endpoint YOUR_ENDPOINT_ID

# 确认 volumeId 和 volumeMountPath 正确设置
# volumeMountPath 必须是 /runpod-volume
```

### 2. 模型加载失败

**症状：** ComfyUI 报错 "Model not found"

**解决：**
```bash
# 通过临时 Pod 检查模型文件
runpodctl create pod --name debug-pod --volumeId YOUR_VOLUME_ID --image runpod/pytorch:latest
runpodctl ssh debug-pod

# 在 Pod 内执行：
ls -lh /runpod-volume/models/unet/
ls -lh /runpod-volume/models/clip/

# 确认文件存在且权限正确
chmod -R 755 /runpod-volume/models/
```

### 3. 自定义节点缺失

**症状：** ComfyUI 报错 "Unknown node type: WanFirstLastFrameToVideo"

**解决：**
- 检查 `start.sh` 中的节点安装部分
- 确认节点仓库地址正确
- 检查依赖是否安装成功

### 4. 生成超时

**症状：** Handler 报错 "TimeoutError"

**解决：**
- 增加 `wait_for_completion` 的 timeout 参数（默认 600 秒）
- 检查 GPU 性能是否足够
- 考虑降低视频分辨率

---

## 下一步优化

### 1. 批量生成优化
- 实现多视频并行生成
- 使用 RunPod 的 batch API

### 2. 缓存优化
- 缓存生成的视频（避免重复生成）
- 使用 CDN 加速视频传输

### 3. 成本优化
- 使用 Spot Instances（成本降低 50-70%）
- 实现请求队列（批量处理降低冷启动成本）

### 4. 监控和日志
- 接入 RunPod Metrics API
- 实现生成进度实时推送（WebSocket）

---

## 参考资源

- [RunPod 官方文档](https://docs.runpod.io/)
- [ComfyUI GitHub](https://github.com/comfyanonymous/ComfyUI)
- [RunPod Serverless 指南](https://docs.runpod.io/serverless/overview)
- [runpodctl CLI 文档](https://docs.runpod.io/cli/overview)

---

## 联系方式

如有问题，请参考：
- RunPod Discord: https://discord.gg/runpod
- ComfyUI GitHub Issues

---

**最后更新：** 2025-11-05
