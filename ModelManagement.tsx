import React, { useState, useEffect } from 'react';

// Type definitions for model configurations
export interface LanguageModelConfig {
    provider: 'gemini' | 'openai-compatible';
    gemini?: {
        apiKey: string;
        modelName: string;
    };
    openaiCompatible?: {
        endpoint: string;
        modelName: string;
        apiKey: string;
    };
}

export interface ImageModelConfig {
    provider: 'gemini' | 'comfyui';
    gemini?: {
        apiKey: string;
        modelName: string;
    };
    comfyui?: {
        endpoint: string;
        workflowName: string;
        loadImageNode: string;
        saveImageNode: string;
        promptNode: string;
        resolution: number;
    };
}

export interface VideoModelConfig {
    provider: 'gemini' | 'comfyui';
    gemini?: {
        apiKey: string;
        modelName: string;
    };
    comfyui?: {
        endpoint: string;
        workflowName: string;
        startFrameNode: string;
        endFrameNode: string;
        promptNode: string;
        saveVideoNode: string;
        resolution: number;
    };
}

export interface ModelSettings {
    languageModel: LanguageModelConfig;
    imageModel: ImageModelConfig;
    videoModel: VideoModelConfig;
}

interface ModelManagementProps {
    onClose: () => void;
    currentSettings?: ModelSettings;
    onSave: (settings: ModelSettings) => void;
}

const ModelManagement: React.FC<ModelManagementProps> = ({ onClose, currentSettings, onSave }) => {
    // Initialize state with current settings or defaults
    const [activeTab, setActiveTab] = useState<'language' | 'image' | 'video'>('language');

    const [languageProvider, setLanguageProvider] = useState<'gemini' | 'openai-compatible'>(
        currentSettings?.languageModel.provider || 'gemini'
    );
    const [languageGeminiKey, setLanguageGeminiKey] = useState(
        currentSettings?.languageModel.gemini?.apiKey || ''
    );
    const [languageGeminiModel, setLanguageGeminiModel] = useState(
        currentSettings?.languageModel.gemini?.modelName || 'gemini-2.5-flash'
    );
    const [languageOpenAIEndpoint, setLanguageOpenAIEndpoint] = useState(
        currentSettings?.languageModel.openaiCompatible?.endpoint || 'http://localhost:11434/v1/chat/completions'
    );
    const [languageOpenAIModel, setLanguageOpenAIModel] = useState(
        currentSettings?.languageModel.openaiCompatible?.modelName || 'llama3'
    );
    const [languageOpenAIKey, setLanguageOpenAIKey] = useState(
        currentSettings?.languageModel.openaiCompatible?.apiKey || ''
    );

    const [imageProvider, setImageProvider] = useState<'gemini' | 'comfyui'>(
        currentSettings?.imageModel.provider || 'gemini'
    );
    const [imageGeminiKey, setImageGeminiKey] = useState(
        currentSettings?.imageModel.gemini?.apiKey || ''
    );
    const [imageGeminiModel, setImageGeminiModel] = useState(
        currentSettings?.imageModel.gemini?.modelName || 'gemini-2.5-flash-image'
    );
    const [imageComfyUIEndpoint, setImageComfyUIEndpoint] = useState(
        currentSettings?.imageModel.comfyui?.endpoint || 'http://127.0.0.1:8188'
    );
    const [imageComfyUIWorkflow, setImageComfyUIWorkflow] = useState(
        currentSettings?.imageModel.comfyui?.workflowName || 'ImageGen.json'
    );
    const [imageLoadImageNode, setImageLoadImageNode] = useState(
        currentSettings?.imageModel.comfyui?.loadImageNode || '10'
    );
    const [imageSaveImageNode, setImageSaveImageNode] = useState(
        currentSettings?.imageModel.comfyui?.saveImageNode || '9'
    );
    const [imagePromptNode, setImagePromptNode] = useState(
        currentSettings?.imageModel.comfyui?.promptNode || '6'
    );
    const [imageResolution, setImageResolution] = useState(
        currentSettings?.imageModel.comfyui?.resolution || 1280
    );

    const [videoProvider, setVideoProvider] = useState<'gemini' | 'comfyui'>(
        currentSettings?.videoModel.provider || 'comfyui'
    );
    const [videoGeminiKey, setVideoGeminiKey] = useState(
        currentSettings?.videoModel.gemini?.apiKey || ''
    );
    const [videoGeminiModel, setVideoGeminiModel] = useState(
        currentSettings?.videoModel.gemini?.modelName || 'veo-3.1-fast-generate-preview'
    );
    const [videoEndpoint, setVideoEndpoint] = useState(
        currentSettings?.videoModel.comfyui?.endpoint || 'http://127.0.0.1:8188'
    );
    const [videoWorkflow, setVideoWorkflow] = useState(
        currentSettings?.videoModel.comfyui?.workflowName || 'WanSE.json'
    );
    const [videoStartFrameNode, setVideoStartFrameNode] = useState(
        currentSettings?.videoModel.comfyui?.startFrameNode || '68'
    );
    const [videoEndFrameNode, setVideoEndFrameNode] = useState(
        currentSettings?.videoModel.comfyui?.endFrameNode || '62'
    );
    const [videoPromptNode, setVideoPromptNode] = useState(
        currentSettings?.videoModel.comfyui?.promptNode || '6'
    );
    const [videoSaveNode, setVideoSaveNode] = useState(
        currentSettings?.videoModel.comfyui?.saveVideoNode || '107'
    );
    const [videoResolution, setVideoResolution] = useState(
        currentSettings?.videoModel.comfyui?.resolution || 512
    );

    const [notification, setNotification] = useState<{ message: string, type: 'success' | 'error' | 'info' } | null>(null);

    const showNotification = (message: string, type: 'success' | 'error' | 'info' = 'info') => {
        setNotification({ message, type });
        setTimeout(() => setNotification(null), 3000);
    };

    const handleSave = () => {
        const settings: ModelSettings = {
            languageModel: {
                provider: languageProvider,
                ...(languageProvider === 'gemini' ? {
                    gemini: {
                        apiKey: languageGeminiKey,
                        modelName: languageGeminiModel
                    }
                } : {
                    openaiCompatible: {
                        endpoint: languageOpenAIEndpoint,
                        modelName: languageOpenAIModel,
                        apiKey: languageOpenAIKey
                    }
                })
            },
            imageModel: {
                provider: imageProvider,
                ...(imageProvider === 'gemini' ? {
                    gemini: {
                        apiKey: imageGeminiKey,
                        modelName: imageGeminiModel
                    }
                } : {
                    comfyui: {
                        endpoint: imageComfyUIEndpoint,
                        workflowName: imageComfyUIWorkflow,
                        loadImageNode: imageLoadImageNode,
                        saveImageNode: imageSaveImageNode,
                        promptNode: imagePromptNode,
                        resolution: imageResolution
                    }
                })
            },
            videoModel: {
                provider: videoProvider,
                ...(videoProvider === 'gemini' ? {
                    gemini: {
                        apiKey: videoGeminiKey,
                        modelName: videoGeminiModel
                    }
                } : {
                    comfyui: {
                        endpoint: videoEndpoint,
                        workflowName: videoWorkflow,
                        startFrameNode: videoStartFrameNode,
                        endFrameNode: videoEndFrameNode,
                        promptNode: videoPromptNode,
                        saveVideoNode: videoSaveNode,
                        resolution: videoResolution
                    }
                })
            }
        };

        onSave(settings);
        showNotification('設定已保存', 'success');
    };

    const handleExportSettings = () => {
        const settings: ModelSettings = {
            languageModel: {
                provider: languageProvider,
                ...(languageProvider === 'gemini' ? {
                    gemini: {
                        apiKey: languageGeminiKey,
                        modelName: languageGeminiModel
                    }
                } : {
                    openaiCompatible: {
                        endpoint: languageOpenAIEndpoint,
                        modelName: languageOpenAIModel,
                        apiKey: languageOpenAIKey
                    }
                })
            },
            imageModel: {
                provider: imageProvider,
                ...(imageProvider === 'gemini' ? {
                    gemini: {
                        apiKey: imageGeminiKey,
                        modelName: imageGeminiModel
                    }
                } : {
                    comfyui: {
                        endpoint: imageComfyUIEndpoint,
                        workflowName: imageComfyUIWorkflow,
                        loadImageNode: imageLoadImageNode,
                        saveImageNode: imageSaveImageNode,
                        promptNode: imagePromptNode,
                        resolution: imageResolution
                    }
                })
            },
            videoModel: {
                provider: videoProvider,
                ...(videoProvider === 'gemini' ? {
                    gemini: {
                        apiKey: videoGeminiKey,
                        modelName: videoGeminiModel
                    }
                } : {
                    comfyui: {
                        endpoint: videoEndpoint,
                        workflowName: videoWorkflow,
                        startFrameNode: videoStartFrameNode,
                        endFrameNode: videoEndFrameNode,
                        promptNode: videoPromptNode,
                        saveVideoNode: videoSaveNode,
                        resolution: videoResolution
                    }
                })
            }
        };

        const dataStr = JSON.stringify(settings, null, 2);
        const dataBlob = new Blob([dataStr], { type: 'application/json' });
        const url = URL.createObjectURL(dataBlob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `model-settings-${new Date().toISOString().split('T')[0]}.json`;
        link.click();
        URL.revokeObjectURL(url);
        showNotification('設定已匯出', 'success');
    };

    const handleImportSettings = (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = (e) => {
            try {
                const settings = JSON.parse(e.target?.result as string) as ModelSettings;

                // Apply language model settings
                setLanguageProvider(settings.languageModel.provider);
                if (settings.languageModel.gemini) {
                    setLanguageGeminiKey(settings.languageModel.gemini.apiKey);
                    setLanguageGeminiModel(settings.languageModel.gemini.modelName || 'gemini-2.5-flash');
                }
                if (settings.languageModel.openaiCompatible) {
                    setLanguageOpenAIEndpoint(settings.languageModel.openaiCompatible.endpoint);
                    setLanguageOpenAIModel(settings.languageModel.openaiCompatible.modelName);
                    setLanguageOpenAIKey(settings.languageModel.openaiCompatible.apiKey);
                }

                // Apply image model settings
                setImageProvider(settings.imageModel.provider);
                if (settings.imageModel.gemini) {
                    setImageGeminiKey(settings.imageModel.gemini.apiKey);
                    setImageGeminiModel(settings.imageModel.gemini.modelName || 'gemini-2.5-flash-image');
                }
                if (settings.imageModel.comfyui) {
                    setImageComfyUIEndpoint(settings.imageModel.comfyui.endpoint);
                    setImageComfyUIWorkflow(settings.imageModel.comfyui.workflowName);
                    setImageLoadImageNode(settings.imageModel.comfyui.loadImageNode);
                    setImageSaveImageNode(settings.imageModel.comfyui.saveImageNode);
                    setImagePromptNode(settings.imageModel.comfyui.promptNode);
                    setImageResolution(settings.imageModel.comfyui.resolution);
                }

                // Apply video model settings
                setVideoProvider(settings.videoModel.provider);
                if (settings.videoModel.gemini) {
                    setVideoGeminiKey(settings.videoModel.gemini.apiKey);
                    setVideoGeminiModel(settings.videoModel.gemini.modelName || 'veo-3.1-fast-generate-preview');
                }
                if (settings.videoModel.comfyui) {
                    setVideoEndpoint(settings.videoModel.comfyui.endpoint);
                    setVideoWorkflow(settings.videoModel.comfyui.workflowName);
                    setVideoStartFrameNode(settings.videoModel.comfyui.startFrameNode);
                    setVideoEndFrameNode(settings.videoModel.comfyui.endFrameNode);
                    setVideoPromptNode(settings.videoModel.comfyui.promptNode);
                    setVideoSaveNode(settings.videoModel.comfyui.saveVideoNode);
                    setVideoResolution(settings.videoModel.comfyui.resolution);
                }

                showNotification('設定已匯入', 'success');
            } catch (error) {
                showNotification('匯入失敗：無效的設定檔案', 'error');
            }
        };
        reader.readAsText(file);
    };

    return (
        <div style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: 'rgba(0, 0, 0, 0.7)',
            display: 'flex',
            justifyContent: 'center',
            alignItems: 'center',
            zIndex: 1000
        }}>
            <div style={{
                backgroundColor: '#1e1e1e',
                borderRadius: '12px',
                width: '90%',
                maxWidth: '900px',
                maxHeight: '90vh',
                overflow: 'hidden',
                display: 'flex',
                flexDirection: 'column',
                boxShadow: '0 8px 32px rgba(0, 0, 0, 0.5)'
            }}>
                {/* Header */}
                <div style={{
                    padding: '20px 24px',
                    borderBottom: '1px solid #333',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    backgroundColor: '#252525'
                }}>
                    <h2 style={{ margin: 0, color: '#fff', fontSize: '20px', fontWeight: 600 }}>模型管理設定</h2>
                    <button
                        onClick={onClose}
                        style={{
                            background: 'none',
                            border: 'none',
                            color: '#999',
                            fontSize: '24px',
                            cursor: 'pointer',
                            padding: '0',
                            width: '32px',
                            height: '32px',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            borderRadius: '4px',
                            transition: 'all 0.2s'
                        }}
                        onMouseOver={(e) => {
                            e.currentTarget.style.backgroundColor = '#333';
                            e.currentTarget.style.color = '#fff';
                        }}
                        onMouseOut={(e) => {
                            e.currentTarget.style.backgroundColor = 'transparent';
                            e.currentTarget.style.color = '#999';
                        }}
                    >
                        ×
                    </button>
                </div>

                {/* Tab Navigation */}
                <div style={{
                    display: 'flex',
                    gap: '0',
                    padding: '0',
                    borderBottom: '1px solid #333',
                    backgroundColor: '#1e1e1e'
                }}>
                    {[
                        { key: 'language', label: '語言模型' },
                        { key: 'image', label: '圖片模型' },
                        { key: 'video', label: '影片模型' }
                    ].map((tab) => (
                        <button
                            key={tab.key}
                            onClick={() => setActiveTab(tab.key as any)}
                            style={{
                                flex: 1,
                                padding: '16px 24px',
                                background: activeTab === tab.key ? '#2a2a2a' : 'transparent',
                                border: 'none',
                                borderBottom: activeTab === tab.key ? '2px solid #4a9eff' : '2px solid transparent',
                                color: activeTab === tab.key ? '#4a9eff' : '#999',
                                fontSize: '15px',
                                fontWeight: activeTab === tab.key ? 600 : 400,
                                cursor: 'pointer',
                                transition: 'all 0.2s'
                            }}
                            onMouseOver={(e) => {
                                if (activeTab !== tab.key) {
                                    e.currentTarget.style.backgroundColor = '#252525';
                                    e.currentTarget.style.color = '#ccc';
                                }
                            }}
                            onMouseOut={(e) => {
                                if (activeTab !== tab.key) {
                                    e.currentTarget.style.backgroundColor = 'transparent';
                                    e.currentTarget.style.color = '#999';
                                }
                            }}
                        >
                            {tab.label}
                        </button>
                    ))}
                </div>

                {/* Content Area */}
                <div style={{
                    flex: 1,
                    overflowY: 'auto',
                    padding: '24px'
                }}>
                    {/* Language Model Tab */}
                    {activeTab === 'language' && (
                        <div>
                            <div style={{ marginBottom: '24px' }}>
                                <label style={{ display: 'block', marginBottom: '12px', color: '#ccc', fontSize: '14px', fontWeight: 500 }}>
                                    選擇語言模型提供者
                                </label>
                                <div style={{ display: 'flex', gap: '12px' }}>
                                    <button
                                        onClick={() => setLanguageProvider('gemini')}
                                        style={{
                                            flex: 1,
                                            padding: '16px',
                                            backgroundColor: languageProvider === 'gemini' ? '#4a9eff' : '#2a2a2a',
                                            border: languageProvider === 'gemini' ? '2px solid #4a9eff' : '2px solid #333',
                                            borderRadius: '8px',
                                            color: languageProvider === 'gemini' ? '#fff' : '#999',
                                            fontSize: '14px',
                                            fontWeight: 500,
                                            cursor: 'pointer',
                                            transition: 'all 0.2s'
                                        }}
                                    >
                                        Google Gemini
                                    </button>
                                    <button
                                        onClick={() => setLanguageProvider('openai-compatible')}
                                        style={{
                                            flex: 1,
                                            padding: '16px',
                                            backgroundColor: languageProvider === 'openai-compatible' ? '#4a9eff' : '#2a2a2a',
                                            border: languageProvider === 'openai-compatible' ? '2px solid #4a9eff' : '2px solid #333',
                                            borderRadius: '8px',
                                            color: languageProvider === 'openai-compatible' ? '#fff' : '#999',
                                            fontSize: '14px',
                                            fontWeight: 500,
                                            cursor: 'pointer',
                                            transition: 'all 0.2s'
                                        }}
                                    >
                                        OpenAI 相容 API
                                    </button>
                                </div>
                            </div>

                            {languageProvider === 'gemini' ? (
                                <>
                                    <div style={{ marginBottom: '20px' }}>
                                        <label style={{ display: 'block', marginBottom: '8px', color: '#ccc', fontSize: '14px' }}>
                                            Gemini API 金鑰
                                        </label>
                                        <input
                                            type="password"
                                            value={languageGeminiKey}
                                            onChange={(e) => setLanguageGeminiKey(e.target.value)}
                                            placeholder="輸入您的 Gemini API 金鑰"
                                            style={{
                                                width: '100%',
                                                padding: '12px',
                                                backgroundColor: '#2a2a2a',
                                                border: '1px solid #333',
                                                borderRadius: '6px',
                                                color: '#fff',
                                                fontSize: '14px'
                                            }}
                                        />
                                    </div>
                                    <div style={{ marginBottom: '20px' }}>
                                        <label style={{ display: 'block', marginBottom: '8px', color: '#ccc', fontSize: '14px' }}>
                                            語言模型版本
                                        </label>
                                        <select
                                            value={languageGeminiModel}
                                            onChange={(e) => setLanguageGeminiModel(e.target.value)}
                                            style={{
                                                width: '100%',
                                                padding: '12px',
                                                backgroundColor: '#2a2a2a',
                                                border: '1px solid #333',
                                                borderRadius: '6px',
                                                color: '#fff',
                                                fontSize: '14px',
                                                cursor: 'pointer'
                                            }}
                                        >
                                            <option value="gemini-2.5-flash">Gemini 2.5 Flash</option>
                                            <option value="gemini-3-pro-preview">Gemini 3 Pro Preview</option>
                                        </select>
                                    </div>
                                </>
                            ) : (
                                <>
                                    <div style={{ marginBottom: '20px' }}>
                                        <label style={{ display: 'block', marginBottom: '8px', color: '#ccc', fontSize: '14px' }}>
                                            API 端點 URL
                                        </label>
                                        <input
                                            type="text"
                                            value={languageOpenAIEndpoint}
                                            onChange={(e) => setLanguageOpenAIEndpoint(e.target.value)}
                                            placeholder="http://localhost:11434/v1/chat/completions"
                                            style={{
                                                width: '100%',
                                                padding: '12px',
                                                backgroundColor: '#2a2a2a',
                                                border: '1px solid #333',
                                                borderRadius: '6px',
                                                color: '#fff',
                                                fontSize: '14px'
                                            }}
                                        />
                                        <div style={{ marginTop: '6px', fontSize: '12px', color: '#666' }}>
                                            例如：http://localhost:11434/v1/chat/completions (Ollama)
                                        </div>
                                    </div>
                                    <div style={{ marginBottom: '20px' }}>
                                        <label style={{ display: 'block', marginBottom: '8px', color: '#ccc', fontSize: '14px' }}>
                                            模型名稱
                                        </label>
                                        <input
                                            type="text"
                                            value={languageOpenAIModel}
                                            onChange={(e) => setLanguageOpenAIModel(e.target.value)}
                                            placeholder="llama3"
                                            style={{
                                                width: '100%',
                                                padding: '12px',
                                                backgroundColor: '#2a2a2a',
                                                border: '1px solid #333',
                                                borderRadius: '6px',
                                                color: '#fff',
                                                fontSize: '14px'
                                            }}
                                        />
                                    </div>
                                    <div style={{ marginBottom: '20px' }}>
                                        <label style={{ display: 'block', marginBottom: '8px', color: '#ccc', fontSize: '14px' }}>
                                            API 金鑰（選填）
                                        </label>
                                        <input
                                            type="password"
                                            value={languageOpenAIKey}
                                            onChange={(e) => setLanguageOpenAIKey(e.target.value)}
                                            placeholder="若需要金鑰請輸入"
                                            style={{
                                                width: '100%',
                                                padding: '12px',
                                                backgroundColor: '#2a2a2a',
                                                border: '1px solid #333',
                                                borderRadius: '6px',
                                                color: '#fff',
                                                fontSize: '14px'
                                            }}
                                        />
                                    </div>
                                </>
                            )}

                            <div style={{
                                marginTop: '24px',
                                padding: '16px',
                                backgroundColor: '#2a2a2a',
                                borderRadius: '8px',
                                borderLeft: '4px solid #4a9eff'
                            }}>
                                <div style={{ color: '#4a9eff', fontSize: '13px', fontWeight: 600, marginBottom: '8px' }}>
                                    用途說明
                                </div>
                                <div style={{ color: '#999', fontSize: '13px', lineHeight: '1.6' }}>
                                    語言模型用於生成分鏡稿提示詞以及影片連接提示詞。您可以選擇使用 Google Gemini 或任何 OpenAI 相容的語言模型（如 Ollama、LM Studio 等）。
                                </div>
                            </div>
                        </div>
                    )}

                    {/* Image Model Tab */}
                    {activeTab === 'image' && (
                        <div>
                            <div style={{ marginBottom: '24px' }}>
                                <label style={{ display: 'block', marginBottom: '12px', color: '#ccc', fontSize: '14px', fontWeight: 500 }}>
                                    選擇圖片模型提供者
                                </label>
                                <div style={{ display: 'flex', gap: '12px' }}>
                                    <button
                                        onClick={() => setImageProvider('gemini')}
                                        style={{
                                            flex: 1,
                                            padding: '16px',
                                            backgroundColor: imageProvider === 'gemini' ? '#4a9eff' : '#2a2a2a',
                                            border: imageProvider === 'gemini' ? '2px solid #4a9eff' : '2px solid #333',
                                            borderRadius: '8px',
                                            color: imageProvider === 'gemini' ? '#fff' : '#999',
                                            fontSize: '14px',
                                            fontWeight: 500,
                                            cursor: 'pointer',
                                            transition: 'all 0.2s'
                                        }}
                                    >
                                        Google Gemini
                                    </button>
                                    <button
                                        onClick={() => setImageProvider('comfyui')}
                                        style={{
                                            flex: 1,
                                            padding: '16px',
                                            backgroundColor: imageProvider === 'comfyui' ? '#4a9eff' : '#2a2a2a',
                                            border: imageProvider === 'comfyui' ? '2px solid #4a9eff' : '2px solid #333',
                                            borderRadius: '8px',
                                            color: imageProvider === 'comfyui' ? '#fff' : '#999',
                                            fontSize: '14px',
                                            fontWeight: 500,
                                            cursor: 'pointer',
                                            transition: 'all 0.2s'
                                        }}
                                    >
                                        ComfyUI 工作流
                                    </button>
                                </div>
                            </div>

                            {imageProvider === 'gemini' ? (
                                <>
                                    <div style={{ marginBottom: '20px' }}>
                                        <label style={{ display: 'block', marginBottom: '8px', color: '#ccc', fontSize: '14px' }}>
                                            Gemini API 金鑰
                                        </label>
                                        <input
                                            type="password"
                                            value={imageGeminiKey}
                                            onChange={(e) => setImageGeminiKey(e.target.value)}
                                            placeholder="輸入您的 Gemini API 金鑰"
                                            style={{
                                                width: '100%',
                                                padding: '12px',
                                                backgroundColor: '#2a2a2a',
                                                border: '1px solid #333',
                                                borderRadius: '6px',
                                                color: '#fff',
                                                fontSize: '14px'
                                            }}
                                        />
                                    </div>
                                    <div style={{ marginBottom: '20px' }}>
                                        <label style={{ display: 'block', marginBottom: '8px', color: '#ccc', fontSize: '14px' }}>
                                            圖片模型版本
                                        </label>
                                        <select
                                            value={imageGeminiModel}
                                            onChange={(e) => setImageGeminiModel(e.target.value)}
                                            style={{
                                                width: '100%',
                                                padding: '12px',
                                                backgroundColor: '#2a2a2a',
                                                border: '1px solid #333',
                                                borderRadius: '6px',
                                                color: '#fff',
                                                fontSize: '14px',
                                                cursor: 'pointer'
                                            }}
                                        >
                                            <option value="gemini-2.5-flash-image">Gemini 2.5 Flash Image</option>
                                            <option value="gemini-3-pro-image-preview">Gemini 3 Pro Image Preview</option>
                                        </select>
                                    </div>
                                </>
                            ) : (
                                <>
                                    <div style={{ marginBottom: '20px' }}>
                                        <label style={{ display: 'block', marginBottom: '8px', color: '#ccc', fontSize: '14px' }}>
                                            ComfyUI 端點
                                        </label>
                                        <input
                                            type="text"
                                            value={imageComfyUIEndpoint}
                                            onChange={(e) => setImageComfyUIEndpoint(e.target.value)}
                                            placeholder="http://127.0.0.1:8188"
                                            style={{
                                                width: '100%',
                                                padding: '12px',
                                                backgroundColor: '#2a2a2a',
                                                border: '1px solid #333',
                                                borderRadius: '6px',
                                                color: '#fff',
                                                fontSize: '14px'
                                            }}
                                        />
                                    </div>
                                    <div style={{ marginBottom: '20px' }}>
                                        <label style={{ display: 'block', marginBottom: '8px', color: '#ccc', fontSize: '14px' }}>
                                            工作流檔案名稱
                                        </label>
                                        <input
                                            type="text"
                                            value={imageComfyUIWorkflow}
                                            onChange={(e) => setImageComfyUIWorkflow(e.target.value)}
                                            placeholder="ImageGen.json"
                                            style={{
                                                width: '100%',
                                                padding: '12px',
                                                backgroundColor: '#2a2a2a',
                                                border: '1px solid #333',
                                                borderRadius: '6px',
                                                color: '#fff',
                                                fontSize: '14px'
                                            }}
                                        />
                                    </div>
                                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', marginBottom: '20px' }}>
                                        <div>
                                            <label style={{ display: 'block', marginBottom: '8px', color: '#ccc', fontSize: '14px' }}>
                                                LoadImage 節點編號
                                            </label>
                                            <input
                                                type="text"
                                                value={imageLoadImageNode}
                                                onChange={(e) => setImageLoadImageNode(e.target.value)}
                                                placeholder="10"
                                                style={{
                                                    width: '100%',
                                                    padding: '12px',
                                                    backgroundColor: '#2a2a2a',
                                                    border: '1px solid #333',
                                                    borderRadius: '6px',
                                                    color: '#fff',
                                                    fontSize: '14px'
                                                }}
                                            />
                                        </div>
                                        <div>
                                            <label style={{ display: 'block', marginBottom: '8px', color: '#ccc', fontSize: '14px' }}>
                                                SaveImage 節點編號
                                            </label>
                                            <input
                                                type="text"
                                                value={imageSaveImageNode}
                                                onChange={(e) => setImageSaveImageNode(e.target.value)}
                                                placeholder="9"
                                                style={{
                                                    width: '100%',
                                                    padding: '12px',
                                                    backgroundColor: '#2a2a2a',
                                                    border: '1px solid #333',
                                                    borderRadius: '6px',
                                                    color: '#fff',
                                                    fontSize: '14px'
                                                }}
                                            />
                                        </div>
                                    </div>
                                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', marginBottom: '20px' }}>
                                        <div>
                                            <label style={{ display: 'block', marginBottom: '8px', color: '#ccc', fontSize: '14px' }}>
                                                提示詞節點編號
                                            </label>
                                            <input
                                                type="text"
                                                value={imagePromptNode}
                                                onChange={(e) => setImagePromptNode(e.target.value)}
                                                placeholder="6"
                                                style={{
                                                    width: '100%',
                                                    padding: '12px',
                                                    backgroundColor: '#2a2a2a',
                                                    border: '1px solid #333',
                                                    borderRadius: '6px',
                                                    color: '#fff',
                                                    fontSize: '14px'
                                                }}
                                            />
                                        </div>
                                        <div>
                                            <label style={{ display: 'block', marginBottom: '8px', color: '#ccc', fontSize: '14px' }}>
                                                解析度
                                            </label>
                                            <input
                                                type="number"
                                                value={imageResolution}
                                                onChange={(e) => setImageResolution(parseInt(e.target.value) || 1280)}
                                                placeholder="1280"
                                                style={{
                                                    width: '100%',
                                                    padding: '12px',
                                                    backgroundColor: '#2a2a2a',
                                                    border: '1px solid #333',
                                                    borderRadius: '6px',
                                                    color: '#fff',
                                                    fontSize: '14px'
                                                }}
                                            />
                                        </div>
                                    </div>
                                </>
                            )}

                            <div style={{
                                marginTop: '24px',
                                padding: '16px',
                                backgroundColor: '#2a2a2a',
                                borderRadius: '8px',
                                borderLeft: '4px solid #4a9eff'
                            }}>
                                <div style={{ color: '#4a9eff', fontSize: '13px', fontWeight: 600, marginBottom: '8px' }}>
                                    用途說明
                                </div>
                                <div style={{ color: '#999', fontSize: '13px', lineHeight: '1.6' }}>
                                    圖片模型用於根據參考圖與提示詞生成分鏡圖片。使用 ComfyUI 時，系統會依照設定的節點編號替換工作流中的數值，並使用指定的解析度生成圖片。
                                </div>
                            </div>
                        </div>
                    )}

                    {/* Video Model Tab */}
                    {activeTab === 'video' && (
                        <div>
                            <div style={{ marginBottom: '24px' }}>
                                <label style={{ display: 'block', marginBottom: '12px', color: '#ccc', fontSize: '14px', fontWeight: 500 }}>
                                    選擇影片模型提供者
                                </label>
                                <div style={{ display: 'flex', gap: '12px' }}>
                                    <button
                                        onClick={() => setVideoProvider('gemini')}
                                        style={{
                                            flex: 1,
                                            padding: '16px',
                                            backgroundColor: videoProvider === 'gemini' ? '#4a9eff' : '#2a2a2a',
                                            border: videoProvider === 'gemini' ? '2px solid #4a9eff' : '2px solid #333',
                                            borderRadius: '8px',
                                            color: videoProvider === 'gemini' ? '#fff' : '#999',
                                            fontSize: '14px',
                                            fontWeight: 500,
                                            cursor: 'pointer',
                                            transition: 'all 0.2s'
                                        }}
                                    >
                                        Google Gemini (Veo 3.1)
                                    </button>
                                    <button
                                        onClick={() => setVideoProvider('comfyui')}
                                        style={{
                                            flex: 1,
                                            padding: '16px',
                                            backgroundColor: videoProvider === 'comfyui' ? '#4a9eff' : '#2a2a2a',
                                            border: videoProvider === 'comfyui' ? '2px solid #4a9eff' : '2px solid #333',
                                            borderRadius: '8px',
                                            color: videoProvider === 'comfyui' ? '#fff' : '#999',
                                            fontSize: '14px',
                                            fontWeight: 500,
                                            cursor: 'pointer',
                                            transition: 'all 0.2s'
                                        }}
                                    >
                                        ComfyUI 工作流
                                    </button>
                                </div>
                            </div>

                            {videoProvider === 'gemini' ? (
                                <>
                                    <div style={{ marginBottom: '20px' }}>
                                        <label style={{ display: 'block', marginBottom: '8px', color: '#ccc', fontSize: '14px' }}>
                                            Gemini API 金鑰
                                        </label>
                                        <input
                                            type="password"
                                            value={videoGeminiKey}
                                            onChange={(e) => setVideoGeminiKey(e.target.value)}
                                            placeholder="輸入您的 Gemini API 金鑰"
                                            style={{
                                                width: '100%',
                                                padding: '12px',
                                                backgroundColor: '#2a2a2a',
                                                border: '1px solid #333',
                                                borderRadius: '6px',
                                                color: '#fff',
                                                fontSize: '14px'
                                            }}
                                        />
                                    </div>
                                    <div style={{ marginBottom: '20px' }}>
                                        <label style={{ display: 'block', marginBottom: '8px', color: '#ccc', fontSize: '14px' }}>
                                            Veo 模型版本
                                        </label>
                                        <select
                                            value={videoGeminiModel}
                                            onChange={(e) => setVideoGeminiModel(e.target.value)}
                                            style={{
                                                width: '100%',
                                                padding: '12px',
                                                backgroundColor: '#2a2a2a',
                                                border: '1px solid #333',
                                                borderRadius: '6px',
                                                color: '#fff',
                                                fontSize: '14px',
                                                cursor: 'pointer'
                                            }}
                                        >
                                            <option value="veo-3.1-fast-generate-preview">Veo 3.1 Fast (Preview)</option>
                                        </select>
                                    </div>
                                </>
                            ) : (
                                <>
                                    <div style={{ marginBottom: '20px' }}>
                                        <label style={{ display: 'block', marginBottom: '8px', color: '#ccc', fontSize: '14px' }}>
                                            ComfyUI 端點
                                        </label>
                                <input
                                    type="text"
                                    value={videoEndpoint}
                                    onChange={(e) => setVideoEndpoint(e.target.value)}
                                    placeholder="http://127.0.0.1:8188"
                                    style={{
                                        width: '100%',
                                        padding: '12px',
                                        backgroundColor: '#2a2a2a',
                                        border: '1px solid #333',
                                        borderRadius: '6px',
                                        color: '#fff',
                                        fontSize: '14px'
                                    }}
                                />
                            </div>
                            <div style={{ marginBottom: '20px' }}>
                                <label style={{ display: 'block', marginBottom: '8px', color: '#ccc', fontSize: '14px' }}>
                                    工作流檔案名稱
                                </label>
                                <input
                                    type="text"
                                    value={videoWorkflow}
                                    onChange={(e) => setVideoWorkflow(e.target.value)}
                                    placeholder="WanSE.json"
                                    style={{
                                        width: '100%',
                                        padding: '12px',
                                        backgroundColor: '#2a2a2a',
                                        border: '1px solid #333',
                                        borderRadius: '6px',
                                        color: '#fff',
                                        fontSize: '14px'
                                    }}
                                />
                            </div>
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', marginBottom: '20px' }}>
                                <div>
                                    <label style={{ display: 'block', marginBottom: '8px', color: '#ccc', fontSize: '14px' }}>
                                        起始幀節點編號
                                    </label>
                                    <input
                                        type="text"
                                        value={videoStartFrameNode}
                                        onChange={(e) => setVideoStartFrameNode(e.target.value)}
                                        placeholder="68"
                                        style={{
                                            width: '100%',
                                            padding: '12px',
                                            backgroundColor: '#2a2a2a',
                                            border: '1px solid #333',
                                            borderRadius: '6px',
                                            color: '#fff',
                                            fontSize: '14px'
                                        }}
                                    />
                                </div>
                                <div>
                                    <label style={{ display: 'block', marginBottom: '8px', color: '#ccc', fontSize: '14px' }}>
                                        結束幀節點編號
                                    </label>
                                    <input
                                        type="text"
                                        value={videoEndFrameNode}
                                        onChange={(e) => setVideoEndFrameNode(e.target.value)}
                                        placeholder="62"
                                        style={{
                                            width: '100%',
                                            padding: '12px',
                                            backgroundColor: '#2a2a2a',
                                            border: '1px solid #333',
                                            borderRadius: '6px',
                                            color: '#fff',
                                            fontSize: '14px'
                                        }}
                                    />
                                </div>
                            </div>
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', marginBottom: '20px' }}>
                                <div>
                                    <label style={{ display: 'block', marginBottom: '8px', color: '#ccc', fontSize: '14px' }}>
                                        提示詞節點編號
                                    </label>
                                    <input
                                        type="text"
                                        value={videoPromptNode}
                                        onChange={(e) => setVideoPromptNode(e.target.value)}
                                        placeholder="6"
                                        style={{
                                            width: '100%',
                                            padding: '12px',
                                            backgroundColor: '#2a2a2a',
                                            border: '1px solid #333',
                                            borderRadius: '6px',
                                            color: '#fff',
                                            fontSize: '14px'
                                        }}
                                    />
                                </div>
                                <div>
                                    <label style={{ display: 'block', marginBottom: '8px', color: '#ccc', fontSize: '14px' }}>
                                        儲存影片節點編號
                                    </label>
                                    <input
                                        type="text"
                                        value={videoSaveNode}
                                        onChange={(e) => setVideoSaveNode(e.target.value)}
                                        placeholder="107"
                                        style={{
                                            width: '100%',
                                            padding: '12px',
                                            backgroundColor: '#2a2a2a',
                                            border: '1px solid #333',
                                            borderRadius: '6px',
                                            color: '#fff',
                                            fontSize: '14px'
                                        }}
                                    />
                                </div>
                            </div>
                            <div style={{ marginBottom: '20px' }}>
                                <label style={{ display: 'block', marginBottom: '8px', color: '#ccc', fontSize: '14px' }}>
                                    影片解析度
                                </label>
                                <input
                                    type="number"
                                    value={videoResolution}
                                    onChange={(e) => setVideoResolution(parseInt(e.target.value) || 512)}
                                    placeholder="512"
                                    style={{
                                        width: '100%',
                                        padding: '12px',
                                        backgroundColor: '#2a2a2a',
                                        border: '1px solid #333',
                                        borderRadius: '6px',
                                        color: '#fff',
                                        fontSize: '14px'
                                    }}
                                />
                                <div style={{ marginTop: '6px', fontSize: '12px', color: '#666' }}>
                                    此數值將用於替換工作流中的解析度設定
                                </div>
                            </div>
                                </>
                            )}

                            <div style={{
                                marginTop: '24px',
                                padding: '16px',
                                backgroundColor: '#2a2a2a',
                                borderRadius: '8px',
                                borderLeft: '4px solid #4a9eff'
                            }}>
                                <div style={{ color: '#4a9eff', fontSize: '13px', fontWeight: 600, marginBottom: '8px' }}>
                                    用途說明
                                </div>
                                <div style={{ color: '#999', fontSize: '13px', lineHeight: '1.6' }}>
                                    {videoProvider === 'gemini'
                                        ? '影片模型使用 Google Gemini Veo 3.1，根據起始圖片、結束圖片及提示詞生成流暢的過渡影片。Veo 3.1 是 Google 最新的影片生成模型，能夠理解圖片之間的關係並生成自然的動態過渡。'
                                        : '影片模型使用 ComfyUI 工作流，根據起始圖片、結束圖片及提示詞生成過渡影片。系統會自動替換工作流中對應節點的數值。'
                                    }
                                </div>
                            </div>
                        </div>
                    )}
                </div>

                {/* Footer with action buttons */}
                <div style={{
                    padding: '16px 24px',
                    borderTop: '1px solid #333',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    backgroundColor: '#252525'
                }}>
                    <div style={{ display: 'flex', gap: '12px' }}>
                        <label
                            style={{
                                padding: '10px 20px',
                                backgroundColor: '#2a2a2a',
                                border: '1px solid #333',
                                borderRadius: '6px',
                                color: '#ccc',
                                fontSize: '14px',
                                cursor: 'pointer',
                                transition: 'all 0.2s',
                                display: 'inline-block'
                            }}
                            onMouseOver={(e) => {
                                e.currentTarget.style.backgroundColor = '#333';
                                e.currentTarget.style.borderColor = '#4a9eff';
                            }}
                            onMouseOut={(e) => {
                                e.currentTarget.style.backgroundColor = '#2a2a2a';
                                e.currentTarget.style.borderColor = '#333';
                            }}
                        >
                            匯入設定
                            <input
                                type="file"
                                accept=".json"
                                onChange={handleImportSettings}
                                style={{ display: 'none' }}
                            />
                        </label>
                        <button
                            onClick={handleExportSettings}
                            style={{
                                padding: '10px 20px',
                                backgroundColor: '#2a2a2a',
                                border: '1px solid #333',
                                borderRadius: '6px',
                                color: '#ccc',
                                fontSize: '14px',
                                cursor: 'pointer',
                                transition: 'all 0.2s'
                            }}
                            onMouseOver={(e) => {
                                e.currentTarget.style.backgroundColor = '#333';
                                e.currentTarget.style.borderColor = '#4a9eff';
                            }}
                            onMouseOut={(e) => {
                                e.currentTarget.style.backgroundColor = '#2a2a2a';
                                e.currentTarget.style.borderColor = '#333';
                            }}
                        >
                            匯出設定
                        </button>
                    </div>
                    <div style={{ display: 'flex', gap: '12px' }}>
                        <button
                            onClick={onClose}
                            style={{
                                padding: '10px 24px',
                                backgroundColor: '#2a2a2a',
                                border: '1px solid #333',
                                borderRadius: '6px',
                                color: '#ccc',
                                fontSize: '14px',
                                cursor: 'pointer',
                                transition: 'all 0.2s'
                            }}
                            onMouseOver={(e) => {
                                e.currentTarget.style.backgroundColor = '#333';
                            }}
                            onMouseOut={(e) => {
                                e.currentTarget.style.backgroundColor = '#2a2a2a';
                            }}
                        >
                            取消
                        </button>
                        <button
                            onClick={handleSave}
                            style={{
                                padding: '10px 24px',
                                backgroundColor: '#4a9eff',
                                border: 'none',
                                borderRadius: '6px',
                                color: '#fff',
                                fontSize: '14px',
                                fontWeight: 500,
                                cursor: 'pointer',
                                transition: 'all 0.2s'
                            }}
                            onMouseOver={(e) => {
                                e.currentTarget.style.backgroundColor = '#3a8eef';
                            }}
                            onMouseOut={(e) => {
                                e.currentTarget.style.backgroundColor = '#4a9eff';
                            }}
                        >
                            保存設定
                        </button>
                    </div>
                </div>

                {/* Notification Toast */}
                {notification && (
                    <div style={{
                        position: 'absolute',
                        top: '24px',
                        right: '24px',
                        padding: '16px 24px',
                        backgroundColor: notification.type === 'success' ? '#10b981' : notification.type === 'error' ? '#ef4444' : '#4a9eff',
                        color: '#fff',
                        borderRadius: '8px',
                        boxShadow: '0 4px 12px rgba(0, 0, 0, 0.3)',
                        fontSize: '14px',
                        fontWeight: 500,
                        zIndex: 1001,
                        animation: 'slideIn 0.3s ease-out'
                    }}>
                        {notification.message}
                    </div>
                )}
            </div>

            <style>{`
                @keyframes slideIn {
                    from {
                        transform: translateX(100%);
                        opacity: 0;
                    }
                    to {
                        transform: translateX(0);
                        opacity: 1;
                    }
                }
            `}</style>
        </div>
    );
};

export default ModelManagement;
