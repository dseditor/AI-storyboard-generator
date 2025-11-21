# AI Storyboard Generator

A powerful AI-powered storyboard generation tool that creates visual storyboards with images and videos from text descriptions. Built with React, Gemini API, and ComfyUI integration.

## ✨ Features

### 🎨 Storyboard Generation
- **AI-Powered Script Generation**: Generate detailed storyboard scripts using Gemini 2.5 Flash
- **Multiple Generation Modes**: Choose from 6 creative modes
  - 👤 Character Closeup
  - 🎬 Character in Scene
  - 📦 Object Closeup
  - 📖 Storytelling Scene
  - ✨ Animation Style
  - 🎨 Freestyle
- **Customizable Cut Count**: Generate any number of storyboard cuts
- **Aspect Ratio Support**: 16:9 and 9:16 formats

### 🖼️ Image Generation
- **Dual Provider Support**:
  - Gemini 2.5 Flash Image
  - ComfyUI with custom workflows
- **Image Regeneration**:
  - Regenerate individual images with random seed
  - Batch regenerate selected images
  - Batch regenerate all images
- **Image Selection**: Color-coded checkbox system (green) for easy management
- **Seed Randomization**: Each regeneration uses a new random seed for variety

### 🎬 Video Generation
- **ComfyUI Integration**: Generate smooth transition videos between cuts
- **Flexible Video Prompts**: Customize motion and transition descriptions
- **Batch Video Generation**:
  - Generate all videos
  - Generate missing videos only
  - Regenerate selected videos
- **Video Selection**: Color-coded checkbox system (blue) for easy management
- **Last Cut Support**: Automatically handles last cut with single-image mode

### 🎞️ Video Post-Processing
- **FFmpeg Integration**: Merge all videos into a single sequence
- **Video Preview**: Preview individual videos or merged result
- **Video Download**: Download individual or merged videos
- **Auto-Merge**: Automatically merge videos after batch generation

### 💾 Project Management
- **Save Projects**: Export entire project as ZIP (with optional video files)
- **Load Projects**: Import previously saved projects
- **Append Projects**: Combine multiple projects sequentially
- **Preset System**: Save and load generation presets/templates

### 🎯 Advanced Features
- **Image Replacement**: Upload custom images for any cut
- **Extend & Correct**: Use previous cut as reference for consistent generation
- **Prompt Editing**: Edit image and video prompts inline
- **Cut Management**: Add, remove, or reorder cuts
- **Detail View**: Click any cut to see full details and editing options
- **Model Management**: Configure multiple AI model providers
- **Responsive Design**: Works on desktop and mobile devices

## 🚀 Getting Started

### Prerequisites
- Node.js (v16 or higher)
- ComfyUI (optional, for video generation)
- Gemini API Key

### Installation

1. Clone the repository:
```bash
git clone https://github.com/yourusername/ai-storyboard-generator.git
cd ai-storyboard-generator
```

2. Install dependencies:
```bash
npm install
```

3. Configure your API keys:
   - Click the ⚙️ settings button in the app
   - Enter your Gemini API key
   - (Optional) Configure ComfyUI endpoint if using video generation

4. Start the development server:
```bash
npm run dev
```

5. Open http://localhost:5173 in your browser

### Building for Production

```bash
npm run build
```

The built files will be in the `dist` directory.

## 🔧 Configuration

### Model Settings

The application supports multiple AI model providers:

#### Language Model (Storyboard Generation)
- **Gemini API**: Use Gemini 2.5 Flash
- **OpenAI-Compatible APIs**: Any OpenAI-compatible endpoint

#### Image Model
- **Gemini API**: Use Gemini 2.5 Flash Image
- **ComfyUI**: Custom image generation workflows

#### Video Model
- **ComfyUI**: Configure workflow file and node IDs
- **Resolution**: Adjustable (default: 512x512)

### ComfyUI Setup

For video generation, you'll need:
1. ComfyUI running locally or on a server
2. A compatible workflow (WanSE.json or custom)
3. Correct node IDs configured in settings:
   - Start Frame Node
   - End Frame Node
   - Prompt Node
   - Save Video Node

## 📖 Usage Guide

### Basic Workflow

1. **Upload Initial Image**: Click or drag an image to the upload area
2. **Select Aspect Ratio**: Choose 16:9 or 9:16
3. **Choose Generation Mode**: Select from 6 creative mode cards
4. **Enter Story Outline**: Describe your story or scene
5. **Set Cut Count**: Specify number of storyboard cuts
6. **Generate Storyboard**: Click "生成分鏡" button
7. **Generate Videos**: Click "生成影片" to create transitions
8. **Merge Videos**: Combine all videos into final sequence

### Image Regeneration

#### Single Image:
1. Click on any cut card to open detail view
2. Click "🔄 重新生成圖片" button
3. New image generated with different seed

#### Batch Regeneration:
1. Select images using green checkboxes
2. Click "⚡ 重新生成選中圖片 (N)" button
3. Or click "🎨 重新生成圖片 (全部)" for all images

### Video Regeneration

#### Single Video:
1. Open cut detail view
2. Edit video prompt if needed
3. Click regenerate button

#### Batch Regeneration:
1. Select videos using blue checkboxes
2. Click "⚡ 重新生成選中 (N)" button
3. Or click "🔄 全部重新生成" for all videos

## 🏗️ Project Structure

```
ai-storyboard-generator/
├── index.html              # Main HTML file
├── index.tsx               # Main React application
├── index.css               # Styles and animations
├── ModelManagement.tsx     # Model configuration component
├── ComfyUI/               # ComfyUI workflow files
│   └── WanSE.json         # Video generation workflow
├── package.json           # Dependencies
└── vite.config.ts         # Vite configuration
```

## 🎨 UI Features

### Modern Design
- Colorful mode cards with gradients and animations
- Smooth transitions and hover effects
- Glass-morphism effects
- Responsive grid layouts
- Dark theme optimized

### Selection System
- **Green Checkboxes**: Image selection
- **Blue Checkboxes**: Video selection
- Independent selection for images and videos
- Batch operations for both types

### Notifications
- In-app toast notifications (non-blocking)
- Success/error/info message types
- Auto-dismiss with animations
- Custom confirm dialogs

## 🔌 API Integration

### Gemini API
- **Models Used**:
  - `gemini-2.5-flash`: Text generation
  - `gemini-2.5-flash-image`: Image generation
- **Features**:
  - JSON mode for structured output
  - Response schema validation
  - Error handling and retry logic

### ComfyUI API
- **Endpoints Used**:
  - `/upload/image`: Upload reference images
  - `/prompt`: Queue generation tasks
  - `/history/{prompt_id}`: Check completion status
  - `/queue`: Monitor queue status
  - `/view`: Download generated files
- **Features**:
  - Workflow customization
  - Node parameter injection
  - Progress polling
  - Multi-output support

## 🛠️ Technologies

- **Frontend**: React 19, TypeScript, Vite
- **AI Services**: Gemini API, ComfyUI
- **Video Processing**: FFmpeg.wasm
- **File Handling**: JSZip
- **Styling**: Pure CSS with CSS Variables

## 📝 License

MIT License - See LICENSE file for details

## 🤝 Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## 📧 Support

For issues and questions, please open an issue on GitHub.

## 🙏 Acknowledgments

- Google Gemini API for AI generation
- ComfyUI for image and video generation
- FFmpeg for video processing
- The open-source community

---

**Built with ❤️ using Claude Code**
