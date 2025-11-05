
import React, { useState, useRef, useCallback, useEffect } from 'react';
import ReactDOM from 'react-dom/client';
import { GoogleGenAI, Type, Modality } from "@google/genai";
import { FFmpeg } from '@ffmpeg/ffmpeg';
import { fetchFile, toBlobURL } from '@ffmpeg/util';

declare var JSZip: any;

const App = () => {
    // State for the original uploaded image
    const [initialImage, setInitialImage] = useState<{ file: File, dataUrl: string } | null>(null);
    // State for the processed (cropped) image to be displayed and used
    const [processedImage, setProcessedImage] = useState<string | null>(null);

    const [aspectRatio, setAspectRatio] = useState('16:9');
    const [outline, setOutline] = useState('');
    const [numCuts, setNumCuts] = useState<number>(3);

    const [isLoading, setIsLoading] = useState(false);
    const [loadingMessage, setLoadingMessage] = useState('');
    const [error, setError] = useState('');

    const [storyboard, setStoryboard] = useState<any[]>([]);
    const [copiedStates, setCopiedStates] = useState<{ [key: number]: boolean }>({});

    // Settings modal state
    const [showSettings, setShowSettings] = useState(false);
    const [apiKey, setApiKey] = useState(localStorage.getItem('apiKey') || process.env.API_KEY || '');
    const [comfyUIUrl, setComfyUIUrl] = useState(localStorage.getItem('comfyUIUrl') || 'http://127.0.0.1:8188');
    const [workflowName, setWorkflowName] = useState(localStorage.getItem('workflowName') || 'WanSE.json');
    const [startFrameNode, setStartFrameNode] = useState(localStorage.getItem('startFrameNode') || '68');
    const [endFrameNode, setEndFrameNode] = useState(localStorage.getItem('endFrameNode') || '62');
    const [promptNode, setPromptNode] = useState(localStorage.getItem('promptNode') || '6');
    const [saveVideoNode, setSaveVideoNode] = useState(localStorage.getItem('saveVideoNode') || '107');
    const [videoResolution, setVideoResolution] = useState(parseInt(localStorage.getItem('videoResolution') || '512'));
    const [saveVideosInProject, setSaveVideosInProject] = useState(localStorage.getItem('saveVideosInProject') === 'true');
    const [projectName, setProjectName] = useState(localStorage.getItem('projectName') || '');

    // Video generation state
    const [isGeneratingVideo, setIsGeneratingVideo] = useState(false);
    const [videoProgress, setVideoProgress] = useState('');
    const [generatedVideos, setGeneratedVideos] = useState<string[]>([]);
    const [videoBlobUrls, setVideoBlobUrls] = useState<string[]>([]);
    const [regeneratingIndex, setRegeneratingIndex] = useState<number | null>(null);
    const [videoVersions, setVideoVersions] = useState<number[]>([]); // Track video versions for force re-render
    const [selectedVideos, setSelectedVideos] = useState<Set<number>>(new Set()); // Track selected videos for batch regeneration
    const [isRegeneratingSelected, setIsRegeneratingSelected] = useState(false); // Track batch regeneration state

    // Video prompt edit modal state
    const [showVideoPromptEdit, setShowVideoPromptEdit] = useState(false);
    const [editingVideoIndex, setEditingVideoIndex] = useState<number | null>(null);
    const [editingVideoPrompt, setEditingVideoPrompt] = useState('');

    // Video preview and merge state
    const [showVideoPreview, setShowVideoPreview] = useState(false);
    const [currentPreviewIndex, setCurrentPreviewIndex] = useState(0);
    const [isMergingVideos, setIsMergingVideos] = useState(false);
    const [mergeProgress, setMergeProgress] = useState('');
    const [ffmpegLoaded, setFfmpegLoaded] = useState(false);
    const [mergedVideoUrl, setMergedVideoUrl] = useState<string | null>(null);

    // Notification state
    const [notification, setNotification] = useState<{ message: string, type: 'success' | 'info' | 'error' } | null>(null);
    const [confirmDialog, setConfirmDialog] = useState<{ message: string, onConfirm: () => void } | null>(null);

    // Preset/template state
    const [showPresetModal, setShowPresetModal] = useState(false);
    const [presetName, setPresetName] = useState('');
    const [savedPresets, setSavedPresets] = useState<any[]>(() => {
        const saved = localStorage.getItem('savedPresets');
        return saved ? JSON.parse(saved) : [];
    });

    const uploadAreaRef = useRef<HTMLDivElement>(null);
    const ffmpegRef = useRef(new FFmpeg());
    const ai = new GoogleGenAI({ apiKey: apiKey || process.env.API_KEY! });

    // Show notification
    const showNotification = (message: string, type: 'success' | 'info' | 'error' = 'info') => {
        setNotification({ message, type });
        setTimeout(() => setNotification(null), 5000);
    };

    // Show confirm dialog
    const showConfirm = (message: string, onConfirm: () => void) => {
        setConfirmDialog({ message, onConfirm });
    };

    // Initialize FFmpeg
    const loadFFmpeg = async () => {
        if (ffmpegLoaded) return;

        try {
            setMergeProgress('Loading FFmpeg...');
            const ffmpeg = ffmpegRef.current;

            const baseURL = 'https://unpkg.com/@ffmpeg/core@0.12.6/dist/esm';
            await ffmpeg.load({
                coreURL: await toBlobURL(`${baseURL}/ffmpeg-core.js`, 'text/javascript'),
                wasmURL: await toBlobURL(`${baseURL}/ffmpeg-core.wasm`, 'application/wasm'),
            });

            ffmpeg.on('log', ({ message }) => {
                console.log('FFmpeg:', message);
            });

            ffmpeg.on('progress', ({ progress }) => {
                setMergeProgress(`Processing video... ${Math.round(progress * 100)}%`);
            });

            setFfmpegLoaded(true);
            setMergeProgress('FFmpeg loaded successfully');
            console.log('FFmpeg loaded');
        } catch (e: any) {
            console.error('Failed to load FFmpeg:', e);
            setError(`Failed to load FFmpeg: ${e.message}`);
        }
    };

    // Download video from URL
    const downloadVideoFromURL = async (url: string): Promise<Blob> => {
        const response = await fetch(url);
        if (!response.ok) {
            throw new Error(`Failed to download video from ${url}`);
        }
        return await response.blob();
    };

    // Merge multiple videos into one
    const mergeVideos = async (autoMerge: boolean = false, videosToMerge?: string[]) => {
        // Use provided videos array or fall back to state
        const videos = videosToMerge || generatedVideos;

        if (videos.length === 0) {
            setError('沒有可合併的影片。請先生成影片。');
            return;
        }

        setIsMergingVideos(true);
        setMergeProgress('準備合併影片...');

        try {
            // Load FFmpeg if not loaded
            await loadFFmpeg();

            const ffmpeg = ffmpegRef.current;
            setMergeProgress('從 ComfyUI 下載影片中...');

            // Download all videos
            const videoBlobs: Blob[] = [];
            for (let i = 0; i < videos.length; i++) {
                setMergeProgress(`下載影片 ${i + 1}/${videos.length}...`);
                const blob = await downloadVideoFromURL(videos[i]);
                videoBlobs.push(blob);
            }

            // Write videos to FFmpeg filesystem
            setMergeProgress('寫入影片到 FFmpeg...');
            for (let i = 0; i < videoBlobs.length; i++) {
                const videoData = await fetchFile(videoBlobs[i]);
                await ffmpeg.writeFile(`video${i}.mp4`, videoData);
            }

            // Create concat file
            const concatContent = videoBlobs.map((_, i) => `file 'video${i}.mp4'`).join('\n');
            await ffmpeg.writeFile('concat.txt', concatContent);

            // Merge videos
            setMergeProgress('合併影片中...');
            await ffmpeg.exec(['-f', 'concat', '-safe', '0', '-i', 'concat.txt', '-c', 'copy', 'output.mp4']);

            // Read the result
            setMergeProgress('讀取合併後的影片...');
            const data = await ffmpeg.readFile('output.mp4');
            const mergedBlob = new Blob([data], { type: 'video/mp4' });

            // Create object URL for preview
            const url = URL.createObjectURL(mergedBlob);
            setMergedVideoUrl(url);

            setMergeProgress('影片合併成功！');
            if (autoMerge) {
                showNotification('影片已自動合併！向下滾動查看預覽。', 'success');
            } else {
                showNotification('影片合併成功！請查看下方預覽。', 'success');
            }

            // Clean up FFmpeg files
            for (let i = 0; i < videoBlobs.length; i++) {
                await ffmpeg.deleteFile(`video${i}.mp4`);
            }
            await ffmpeg.deleteFile('concat.txt');
            await ffmpeg.deleteFile('output.mp4');

        } catch (e: any) {
            console.error('Video merge error:', e);
            setError(`合併影片失敗：${e.message}`);
        } finally {
            setIsMergingVideos(false);
        }
    };

    // Download merged video
    const downloadMergedVideo = () => {
        if (!mergedVideoUrl) return;

        const link = document.createElement('a');
        link.href = mergedVideoUrl;
        link.download = `storyboard_video_${Date.now()}.mp4`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        showNotification('影片下載成功！', 'success');
    };

    // Regenerate a single video
    const regenerateSingleVideo = async (index: number, newPrompt: string) => {
        if (index < 0 || index >= storyboard.length) {
            setError('無效的影片索引');
            return;
        }

        const currentCut = storyboard[index];
        const nextCut = index < storyboard.length - 1 ? storyboard[index + 1] : null;
        const isLastCut = (index === storyboard.length - 1);

        if (!currentCut.generated_image) {
            setError(`Cut ${index + 1} 的圖片尚未生成`);
            return;
        }

        if (!isLastCut && !nextCut?.generated_image) {
            setError(`Cut ${index + 2} 的圖片尚未生成`);
            return;
        }

        setRegeneratingIndex(index);
        setError('');

        try {
            console.log(`\n=== Regenerating Video ${index + 1} ===`);
            if (isLastCut) {
                console.log(`Last Cut: Cut ${index + 1} (single-image mode)`);
            } else {
                console.log(`Start: Cut ${index + 1}, End: Cut ${index + 2}`);
            }
            console.log(`New Prompt: ${newPrompt.substring(0, 100)}...`);

            // Update storyboard with new prompt using functional update
            setStoryboard(prevStoryboard => {
                const updated = [...prevStoryboard];
                updated[index].video_prompt = newPrompt;
                return updated;
            });

            // Generate video
            const videoUrl = await generateVideoWithComfyUI(
                currentCut.generated_image,
                nextCut?.generated_image || null,
                newPrompt
            );

            console.log(`✓ Video ${index + 1} regenerated: ${videoUrl}`);

            // Create new blob URL first
            const blob = await downloadVideoFromURL(videoUrl);
            const blobUrl = URL.createObjectURL(blob);

            // Get the old blob URL before updating (outside of setter to avoid closure issues)
            const oldBlobUrl = videoBlobUrls[index];

            // Update all states
            setGeneratedVideos(prevVideos => {
                const updated = [...prevVideos];
                updated[index] = videoUrl;
                return updated;
            });

            setVideoBlobUrls(prevBlobUrls => {
                const updated = [...prevBlobUrls];
                updated[index] = blobUrl;
                return updated;
            });

            setVideoVersions(prevVersions => {
                const updated = [...prevVersions];
                updated[index] = (updated[index] || 1) + 1;
                return updated;
            });

            // Revoke old blob URL after a delay to allow React to re-render
            // This prevents ERR_FILE_NOT_FOUND when the video element is still using the old URL
            if (oldBlobUrl && oldBlobUrl.startsWith('blob:')) {
                setTimeout(() => {
                    try {
                        URL.revokeObjectURL(oldBlobUrl);
                        console.log(`✓ Revoked old blob URL for video ${index + 1}`);
                    } catch (e) {
                        console.warn(`Failed to revoke blob URL for video ${index + 1}:`, e);
                    }
                }, 2000); // Delay 2 seconds to ensure React has updated the video element
            }

            showNotification(`影片 ${index + 1} 重新生成成功！`, 'success');

            // Auto re-merge videos - get latest videos from state
            setTimeout(() => {
                setGeneratedVideos(currentVideos => {
                    mergeVideos(true, currentVideos);
                    return currentVideos;
                });
            }, 500);

        } catch (e: any) {
            console.error(`Video ${index + 1} regeneration failed:`, e);
            setError(`重新生成影片 ${index + 1} 失敗：${e.message}`);
        } finally {
            setRegeneratingIndex(null);
        }
    };

    // Toggle video selection
    const toggleVideoSelection = (index: number) => {
        setSelectedVideos(prev => {
            const newSet = new Set(prev);
            if (newSet.has(index)) {
                newSet.delete(index);
            } else {
                newSet.add(index);
            }
            return newSet;
        });
    };

    // Select all videos
    const selectAllVideos = () => {
        const allIndices = videoBlobUrls
            .map((_, index) => index)
            .filter(index => videoBlobUrls[index]); // Only include videos that exist
        setSelectedVideos(new Set(allIndices));
    };

    // Deselect all videos
    const deselectAllVideos = () => {
        setSelectedVideos(new Set());
    };

    // Regenerate selected videos in order
    const handleRegenerateSelected = async () => {
        if (selectedVideos.size === 0) {
            showNotification('請先選擇要重新生成的影片', 'info');
            return;
        }

        setIsRegeneratingSelected(true);
        setError('');

        // Sort selected indices by cut order
        const sortedIndices = Array.from(selectedVideos).sort((a, b) => a - b);

        try {
            console.log(`\n=== Batch Regenerating ${sortedIndices.length} Videos ===`);
            console.log(`Selected indices: ${sortedIndices.join(', ')}`);

            for (let i = 0; i < sortedIndices.length; i++) {
                const index = sortedIndices[i];
                const currentCut = storyboard[index];
                const nextCut = index < storyboard.length - 1 ? storyboard[index + 1] : null;
                const isLastCut = (index === storyboard.length - 1);

                setVideoProgress(`重新生成影片 ${i + 1} / ${sortedIndices.length}... (Cut ${index + 1})`);
                setRegeneratingIndex(index);

                if (!currentCut.generated_image) {
                    console.warn(`Skipping Cut ${index + 1}: image not generated`);
                    continue;
                }

                if (!isLastCut && !nextCut?.generated_image) {
                    console.warn(`Skipping Cut ${index + 1}: next cut image not generated`);
                    continue;
                }

                try {
                    console.log(`\n=== Regenerating Video ${i + 1} / ${sortedIndices.length} (Cut ${index + 1}) ===`);
                    if (isLastCut) {
                        console.log(`Last Cut: Cut ${index + 1} (single-image mode)`);
                    } else {
                        console.log(`Start: Cut ${index + 1}, End: Cut ${index + 2}`);
                    }
                    console.log(`Prompt: ${currentCut.video_prompt.substring(0, 100)}...`);

                    // Generate video
                    const videoUrl = await generateVideoWithComfyUI(
                        currentCut.generated_image,
                        nextCut?.generated_image || null,
                        currentCut.video_prompt
                    );

                    console.log(`✓ Video ${index + 1} regenerated: ${videoUrl}`);

                    // Create new blob URL
                    const blob = await downloadVideoFromURL(videoUrl);
                    const blobUrl = URL.createObjectURL(blob);

                    // Get the old blob URL before updating (outside of setter to avoid closure issues)
                    const oldBlobUrl = videoBlobUrls[index];

                    // Update all states
                    setGeneratedVideos(prevVideos => {
                        const updated = [...prevVideos];
                        updated[index] = videoUrl;
                        return updated;
                    });

                    setVideoBlobUrls(prevBlobUrls => {
                        const updated = [...prevBlobUrls];
                        updated[index] = blobUrl;
                        return updated;
                    });

                    setVideoVersions(prevVersions => {
                        const updated = [...prevVersions];
                        updated[index] = (updated[index] || 1) + 1;
                        return updated;
                    });

                    // Revoke old blob URL after a delay to allow React to re-render
                    // This prevents ERR_FILE_NOT_FOUND when the video element is still using the old URL
                    if (oldBlobUrl && oldBlobUrl.startsWith('blob:')) {
                        setTimeout(() => {
                            try {
                                URL.revokeObjectURL(oldBlobUrl);
                                console.log(`✓ Revoked old blob URL for video ${index + 1}`);
                            } catch (e) {
                                console.warn(`Failed to revoke blob URL for video ${index + 1}:`, e);
                            }
                        }, 2000); // Delay 2 seconds to ensure React has updated the video element
                    }

                    // Small delay between videos to ensure ComfyUI is ready
                    if (i < sortedIndices.length - 1) {
                        console.log('Waiting 3 seconds before next video...');
                        await new Promise(resolve => setTimeout(resolve, 3000));
                    }

                } catch (videoError: any) {
                    console.error(`✗ Video ${index + 1} regeneration failed:`, videoError);
                    showNotification(`影片 ${index + 1} 重新生成失敗：${videoError.message}`, 'error');
                    // Continue with next video even if one fails
                }
            }

            showNotification(`成功重新生成 ${sortedIndices.length} 個影片！`, 'success');

            // Clear selection after successful regeneration
            setSelectedVideos(new Set());

            // Auto-merge videos after regeneration
            setTimeout(() => {
                setGeneratedVideos(currentVideos => {
                    mergeVideos(true, currentVideos);
                    return currentVideos;
                });
            }, 1000);

        } catch (e: any) {
            console.error('Batch regeneration error:', e);
            setError(`批量重新生成失敗：${e.message}`);
        } finally {
            setIsRegeneratingSelected(false);
            setRegeneratingIndex(null);
            setVideoProgress('');
        }
    };

    // Open video prompt edit modal
    const openVideoPromptEdit = (index: number) => {
        setEditingVideoIndex(index);
        setEditingVideoPrompt(storyboard[index].video_prompt);
        setShowVideoPromptEdit(true);
    };

    // Handle video prompt edit submission
    const handleVideoPromptEditSubmit = async () => {
        if (editingVideoIndex === null) return;

        setShowVideoPromptEdit(false);
        await regenerateSingleVideo(editingVideoIndex, editingVideoPrompt);
        setEditingVideoIndex(null);
        setEditingVideoPrompt('');
    };

    // Save settings to localStorage
    const handleSaveSettings = () => {
        localStorage.setItem('apiKey', apiKey);
        localStorage.setItem('comfyUIUrl', comfyUIUrl);
        localStorage.setItem('workflowName', workflowName);
        localStorage.setItem('startFrameNode', startFrameNode);
        localStorage.setItem('endFrameNode', endFrameNode);
        localStorage.setItem('promptNode', promptNode);
        localStorage.setItem('saveVideoNode', saveVideoNode);
        localStorage.setItem('videoResolution', videoResolution.toString());
        localStorage.setItem('saveVideosInProject', saveVideosInProject.toString());
        localStorage.setItem('projectName', projectName);
        setShowSettings(false);
        showNotification('設定已儲存！', 'success');
    };

    // Save current settings as a preset
    const handleSavePreset = () => {
        if (!presetName.trim()) {
            showNotification('請輸入範本名稱', 'error');
            return;
        }

        const preset = {
            name: presetName,
            workflowName,
            startFrameNode,
            endFrameNode,
            promptNode,
            saveVideoNode,
            videoResolution,
            createdAt: new Date().toISOString()
        };

        const updatedPresets = [...savedPresets, preset];
        setSavedPresets(updatedPresets);
        localStorage.setItem('savedPresets', JSON.stringify(updatedPresets));

        setPresetName('');
        setShowPresetModal(false);
        showNotification(`範本 "${preset.name}" 已儲存！`, 'success');
    };

    // Load a preset
    const handleLoadPreset = (preset: any) => {
        setWorkflowName(preset.workflowName);
        setStartFrameNode(preset.startFrameNode);
        setEndFrameNode(preset.endFrameNode);
        setPromptNode(preset.promptNode);
        setSaveVideoNode(preset.saveVideoNode);
        setVideoResolution(preset.videoResolution);

        showNotification(`範本 "${preset.name}" 已載入！`, 'success');
    };

    // Delete a preset
    const handleDeletePreset = (index: number) => {
        const presetToDelete = savedPresets[index];
        showConfirm(`確定要刪除範本 "${presetToDelete.name}" 嗎？`, () => {
            const updatedPresets = savedPresets.filter((_, i) => i !== index);
            setSavedPresets(updatedPresets);
            localStorage.setItem('savedPresets', JSON.stringify(updatedPresets));
            showNotification(`範本 "${presetToDelete.name}" 已刪除`, 'success');
            setConfirmDialog(null);
        });
    };

    // Load ComfyUI workflow
    const loadWorkflow = async (): Promise<any> => {
        try {
            const response = await fetch(`./ComfyUI/${workflowName}`);
            if (!response.ok) throw new Error(`無法載入工作流檔案: ${workflowName}`);
            return await response.json();
        } catch (e: any) {
            throw new Error(`載入工作流失敗: ${e.message}`);
        }
    };

    // Convert base64 to blob and upload to ComfyUI
    const uploadImageToComfyUI = async (base64Image: string, filename: string): Promise<string> => {
        const blob = await base64ToBlob(base64Image);
        const formData = new FormData();
        formData.append('image', blob, filename);
        formData.append('overwrite', 'true');

        const response = await fetch(`${comfyUIUrl}/upload/image`, {
            method: 'POST',
            body: formData,
        });

        if (!response.ok) {
            throw new Error(`圖片上傳失敗: ${response.statusText}`);
        }

        const result = await response.json();
        return result.name || filename;
    };

    // Generate video using ComfyUI
    const generateVideoWithComfyUI = async (startImage: string, endImage: string | null, videoPrompt: string): Promise<string> => {
        const workflow = await loadWorkflow();

        // Update prompt
        workflow[promptNode].inputs.text = videoPrompt;

        // Generate random noise seeds for video generation
        const randomSeed1 = Math.floor(Math.random() * 1000000000000000);
        const randomSeed2 = Math.floor(Math.random() * 1000000000000000);

        // Update noise_seed in KSampler nodes (57 and 58)
        if (workflow['57'] && workflow['57'].inputs && workflow['57'].inputs.noise_seed !== undefined) {
            workflow['57'].inputs.noise_seed = randomSeed1;
        }
        if (workflow['58'] && workflow['58'].inputs && workflow['58'].inputs.noise_seed !== undefined) {
            workflow['58'].inputs.noise_seed = randomSeed2;
        }

        // Update video resolution in all relevant nodes
        Object.keys(workflow).forEach(nodeId => {
            const node = workflow[nodeId];
            if (node.inputs) {
                // Update width and height if they exist and are set to 512
                if (node.inputs.width === 512) {
                    node.inputs.width = videoResolution;
                }
                if (node.inputs.height === 512) {
                    node.inputs.height = videoResolution;
                }
            }
        });

        // If endImage is provided, configure workflow for dual-image mode
        if (endImage) {
            // Dual-image mode: upload both images
            const startImageName = await uploadImageToComfyUI(startImage, `start_${Date.now()}.png`);
            const endImageName = await uploadImageToComfyUI(endImage, `end_${Date.now()}.png`);
            // Note: In workflow, node 62 (endFrameNode) is start_image, node 68 (startFrameNode) is end_image
            // So we need to swap the assignment to match the correct flow: cut i -> cut i+1
            workflow[endFrameNode].inputs.image = startImageName;   // Node 62 = start_image (cut i)
            workflow[startFrameNode].inputs.image = endImageName;   // Node 68 = end_image (cut i+1)
        } else {
            // Single-image mode (last cut): only upload one image
            // Note: endFrameNode (62) is used as start_image in node 67
            const imageName = await uploadImageToComfyUI(startImage, `start_${Date.now()}.png`);
            workflow[endFrameNode].inputs.image = imageName;

            // Remove end_image connection and startFrameNode (like WanSE2.json)
            const videoNode = '67'; // WanFirstLastFrameToVideo node
            if (workflow[videoNode] && workflow[videoNode].inputs) {
                delete workflow[videoNode].inputs.end_image;
            }
            // Remove startFrameNode (68) as it's not needed for single-image mode
            if (workflow[startFrameNode]) {
                delete workflow[startFrameNode];
            }
        }

        // Queue prompt
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

        // Poll for completion
        return await waitForCompletion(promptId);
    };

    // Alternative method: Check if prompt is still in queue
    const checkQueueStatus = async (promptId: string): Promise<boolean> => {
        try {
            const queueResponse = await fetch(`${comfyUIUrl}/queue`);
            if (!queueResponse.ok) return false;

            const queueData = await queueResponse.json();
            // Check if promptId is in queue_running or queue_pending
            const inRunning = queueData.queue_running?.some((item: any) => item[1] === promptId);
            const inPending = queueData.queue_pending?.some((item: any) => item[1] === promptId);

            return inRunning || inPending;
        } catch (e) {
            console.warn('Failed to check queue status:', e);
            return false;
        }
    };

    // Wait for ComfyUI to complete generation
    const waitForCompletion = async (promptId: string): Promise<string> => {
        return new Promise((resolve, reject) => {
            let attempts = 0;
            const maxAttempts = 300; // 10 minutes at 2 second intervals
            let hasSeenInQueue = false;

            const checkInterval = setInterval(async () => {
                try {
                    attempts++;

                    if (attempts > maxAttempts) {
                        clearInterval(checkInterval);
                        reject(new Error('Video generation timeout (10 minutes)'));
                        return;
                    }

                    // Check queue status
                    const stillInQueue = await checkQueueStatus(promptId);
                    if (stillInQueue) {
                        hasSeenInQueue = true;
                        console.log(`Prompt ${promptId} is still in queue (attempt ${attempts})`);
                        return; // Continue polling
                    }

                    // If it was in queue but now it's not, check history
                    const historyResponse = await fetch(`${comfyUIUrl}/history/${promptId}`);
                    if (!historyResponse.ok) {
                        console.warn(`History API returned ${historyResponse.status}, retrying...`);
                        return; // Continue polling
                    }

                    const history = await historyResponse.json();
                    const promptData = history[promptId];

                    if (!promptData) {
                        // If we haven't seen it in queue yet, keep waiting
                        if (!hasSeenInQueue) {
                            console.warn(`Prompt ${promptId} not found in history or queue, retrying...`);
                            return; // Continue polling
                        } else {
                            // It was in queue but now disappeared - possible error
                            clearInterval(checkInterval);
                            reject(new Error('Prompt disappeared from queue and history'));
                            return;
                        }
                    }

                    // Check if the prompt has completed (outputs exist)
                    // ComfyUI adds outputs when generation is complete
                    const outputs = promptData.outputs;

                    if (outputs && Object.keys(outputs).length > 0) {
                        clearInterval(checkInterval);

                        console.log('ComfyUI outputs received:', JSON.stringify(outputs, null, 2));

                        // Get the output from SaveVideo node
                        if (outputs[saveVideoNode]) {
                            const videoData = outputs[saveVideoNode];
                            console.log(`SaveVideo node (${saveVideoNode}) output:`, JSON.stringify(videoData, null, 2));

                            // Try multiple possible output formats
                            let videoFilename = null;
                            let subfolder = '';
                            let fullPath = null;

                            // Method 1: VHS VideoCombine format (VHS_FILENAMES)
                            // Returns array: [save_output_enabled, [list of full file paths]]
                            if (videoData.gifs && Array.isArray(videoData.gifs) && videoData.gifs.length >= 2) {
                                const filePaths = videoData.gifs[1]; // Second element is the file paths array
                                if (Array.isArray(filePaths) && filePaths.length > 0) {
                                    // Use the last item in the array (most complete output)
                                    fullPath = filePaths[filePaths.length - 1];
                                    // Extract filename from full path
                                    videoFilename = fullPath.split(/[\\/]/).pop(); // Get last part of path
                                    console.log('Found video in VHS_FILENAMES format:', videoFilename);
                                    console.log('Full path:', fullPath);
                                }
                            }
                            // Method 2: Standard gifs array with objects
                            else if (videoData.gifs && Array.isArray(videoData.gifs) && videoData.gifs.length > 0) {
                                const gifItem = videoData.gifs[0];
                                if (typeof gifItem === 'object' && gifItem.filename) {
                                    videoFilename = gifItem.filename;
                                    subfolder = gifItem.subfolder || '';
                                    console.log('Found video in gifs object array:', videoFilename);
                                } else if (typeof gifItem === 'string') {
                                    videoFilename = gifItem;
                                    console.log('Found video in gifs string array:', videoFilename);
                                }
                            }
                            // Method 3: Check for animated array (SaveVideo node)
                            else if (videoData.animated && videoData.animated.length > 0) {
                                const animatedItem = videoData.animated[0];
                                if (typeof animatedItem === 'string') {
                                    videoFilename = animatedItem;
                                } else if (animatedItem.filename) {
                                    videoFilename = animatedItem.filename;
                                    subfolder = animatedItem.subfolder || '';
                                }
                                console.log('Found video in animated array:', videoFilename, subfolder ? `(subfolder: ${subfolder})` : '');
                            }
                            // Method 4: Check for videos array
                            else if (videoData.videos && videoData.videos.length > 0) {
                                videoFilename = videoData.videos[0].filename;
                                subfolder = videoData.videos[0].subfolder || '';
                                console.log('Found video in videos array:', videoFilename);
                            }
                            // Method 5: Check for filenames array
                            else if (videoData.filenames && videoData.filenames.length > 0) {
                                videoFilename = videoData.filenames[0];
                                console.log('Found video in filenames array:', videoFilename);
                            }
                            // Method 6: Check for ui object
                            else if (videoData.ui && videoData.ui.videos && videoData.ui.videos.length > 0) {
                                videoFilename = videoData.ui.videos[0].filename;
                                subfolder = videoData.ui.videos[0].subfolder || '';
                                console.log('Found video in ui.videos:', videoFilename);
                            }
                            // Method 7: Direct filename property
                            else if (videoData.filename) {
                                videoFilename = videoData.filename;
                                console.log('Found video in filename property:', videoFilename);
                            }

                            if (videoFilename) {
                                const videoUrl = subfolder
                                    ? `${comfyUIUrl}/view?filename=${videoFilename}&subfolder=${subfolder}&type=output`
                                    : `${comfyUIUrl}/view?filename=${videoFilename}&type=output`;
                                console.log('Video URL:', videoUrl);
                                resolve(videoUrl);
                            } else {
                                console.error('Video data structure:', videoData);
                                reject(new Error(`No video file found in SaveVideo node output. Output structure: ${JSON.stringify(Object.keys(videoData))}`));
                            }
                        } else {
                            console.error('Available output nodes:', Object.keys(outputs));
                            reject(new Error(`SaveVideo node (${saveVideoNode}) did not produce output. Available nodes: ${Object.keys(outputs).join(', ')}`));
                        }
                    } else {
                        // Check if there's an error status
                        const status = promptData.status;
                        if (status && status.status_str === 'error') {
                            clearInterval(checkInterval);
                            const errorMessages = status.messages || [];
                            reject(new Error(`ComfyUI error: ${JSON.stringify(errorMessages)}`));
                        }
                        // Otherwise continue polling
                    }
                } catch (e: any) {
                    console.error('Error checking completion:', e);
                    // Don't reject immediately, continue polling unless it's a network error
                    if (e.message.includes('fetch')) {
                        clearInterval(checkInterval);
                        reject(e);
                    }
                }
            }, 2000); // Check every 2 seconds
        });
    };

    // Handle batch video generation
    const handleGenerateVideos = async () => {
        if (!storyboard || storyboard.length < 2) {
            setError('At least 2 cuts are required to generate videos');
            return;
        }

        if (!comfyUIUrl || !workflowName) {
            setError('Please configure ComfyUI parameters in settings first');
            return;
        }

        setIsGeneratingVideo(true);
        setError('');

        // Clean up old blob URLs before generating new ones
        videoBlobUrls.forEach(url => {
            if (url.startsWith('blob:')) {
                URL.revokeObjectURL(url);
            }
        });
        setVideoBlobUrls([]);
        setVideoVersions([]);

        const generatedVideos: string[] = [];

        try {
            // Generate videos for each cut (including the last one)
            const numVideos = storyboard.length; // Generate video for each cut

            console.log(`Starting video generation for ${numVideos} videos (${storyboard.length} cuts)...`);

            for (let i = 0; i < numVideos; i++) {
                const currentCut = storyboard[i];
                const nextCut = i < storyboard.length - 1 ? storyboard[i + 1] : null;
                const isLastCut = (i === storyboard.length - 1);

                if (!currentCut.generated_image) {
                    throw new Error(`Cut ${i + 1} image not generated yet`);
                }

                if (!isLastCut && !nextCut?.generated_image) {
                    throw new Error(`Cut ${i + 2} image not generated yet`);
                }

                if (isLastCut) {
                    setVideoProgress(`Generating video ${i + 1} / ${numVideos}... (Cut${i + 1} ending)`);
                    console.log(`\n=== Video ${i + 1} / ${numVideos} ===`);
                    console.log(`Last Cut: Cut ${i + 1} (single-image mode)`);
                    console.log(`Prompt: ${currentCut.video_prompt.substring(0, 100)}...`);
                } else {
                    setVideoProgress(`Generating video ${i + 1} / ${numVideos}... (Cut${i + 1} -> Cut${i + 2})`);
                    console.log(`\n=== Video ${i + 1} / ${numVideos} ===`);
                    console.log(`Start: Cut ${i + 1}, End: Cut ${i + 2}`);
                    console.log(`Prompt: ${currentCut.video_prompt.substring(0, 100)}...`);
                }

                try {
                    const videoUrl = await generateVideoWithComfyUI(
                        currentCut.generated_image,
                        nextCut?.generated_image || null,
                        currentCut.video_prompt
                    );

                    generatedVideos.push(videoUrl);
                    console.log(`✓ Video ${i + 1} completed: ${videoUrl}`);
                    setVideoProgress(`Video ${i + 1} completed successfully!`);

                    // Small delay between videos to ensure ComfyUI is ready
                    if (i < numVideos - 1) {
                        console.log('Waiting 3 seconds before next video...');
                        await new Promise(resolve => setTimeout(resolve, 3000));
                    }

                } catch (videoError: any) {
                    console.error(`✗ Video ${i + 1} failed:`, videoError);
                    throw new Error(`Video ${i + 1} generation failed: ${videoError.message}`);
                }
            }

            const successMessage = `All videos generated successfully! Generated ${generatedVideos.length} videos.`;
            console.log('\n' + successMessage);
            setVideoProgress(`All ${generatedVideos.length} videos completed!`);

            // Save video URLs to state
            setGeneratedVideos(generatedVideos);

            // Convert ComfyUI URLs to blob URLs for preview (to avoid CORS issues)
            setVideoProgress('創建預覽連結...');
            const blobUrls: string[] = [];
            for (let i = 0; i < generatedVideos.length; i++) {
                try {
                    const blob = await downloadVideoFromURL(generatedVideos[i]);
                    const blobUrl = URL.createObjectURL(blob);
                    blobUrls.push(blobUrl);
                } catch (e) {
                    console.error(`Failed to create blob URL for video ${i + 1}:`, e);
                    // Fallback to original URL if blob creation fails
                    blobUrls.push(generatedVideos[i]);
                }
            }
            setVideoBlobUrls(blobUrls);

            // Initialize video versions
            setVideoVersions(generatedVideos.map((_, i) => 1));

            showNotification(successMessage, 'success');

            // Automatically merge videos after generation
            // Pass the videos array directly to avoid state update delay
            setTimeout(() => {
                mergeVideos(true, generatedVideos);
            }, 1000);

        } catch (e: any) {
            console.error('Video generation error:', e);
            setError(`影片生成失敗：${e.message}`);
        } finally {
            setIsGeneratingVideo(false);
        }
    };

    /**
     * Crops an image from the center to match the target aspect ratio.
     */
    const cropImageToAspectRatio = (dataUrl: string, targetRatioString: string): Promise<string> => {
        return new Promise((resolve, reject) => {
            const img = new Image();
            img.onload = () => {
                const [targetW, targetH] = targetRatioString.split(':').map(Number);
                const targetRatio = targetW / targetH;
                const imageRatio = img.width / img.height;

                let sWidth = img.width;
                let sHeight = img.height;
                let sx = 0;
                let sy = 0;

                // Determine crop dimensions
                if (imageRatio > targetRatio) { // Image is wider than target, crop width
                    sWidth = img.height * targetRatio;
                    sx = (img.width - sWidth) / 2;
                } else if (imageRatio < targetRatio) { // Image is taller than target, crop height
                    sHeight = img.width / targetRatio;
                    sy = (img.height - sHeight) / 2;
                }

                const canvas = document.createElement('canvas');
                canvas.width = sWidth;
                canvas.height = sHeight;
                const ctx = canvas.getContext('2d');

                if (!ctx) {
                    return reject(new Error('無法獲取 Canvas Context'));
                }

                // Draw the cropped portion of the image onto the canvas
                ctx.drawImage(img, sx, sy, sWidth, sHeight, 0, 0, sWidth, sHeight);
                
                resolve(canvas.toDataURL('image/png'));
            };
            img.onerror = () => reject(new Error("無法載入圖片以進行裁切。"));
            img.src = dataUrl;
        });
    };

    // Effect to crop the image whenever the source image or aspect ratio changes
    useEffect(() => {
        if (!initialImage) {
            setProcessedImage(null);
            return;
        }

        const performCrop = async () => {
            try {
                setError('');
                const croppedDataUrl = await cropImageToAspectRatio(initialImage.dataUrl, aspectRatio);
                setProcessedImage(croppedDataUrl);
            } catch (e: any) {
                console.error("Cropping failed:", e);
                setError(`圖片裁切失敗: ${e.message}`);
                setProcessedImage(initialImage.dataUrl); // Fallback to showing the original image on error
            }
        };

        performCrop();
    }, [initialImage, aspectRatio]);


    const handleImagePromptChange = (index: number, newPrompt: string) => {
        setStoryboard(prevStoryboard => {
            const updated = [...prevStoryboard];
            updated[index].image_prompt = newPrompt;
            return updated;
        });
    };

    const handleVideoPromptChange = (index: number, newPrompt: string) => {
        setStoryboard(prevStoryboard => {
            const updated = [...prevStoryboard];
            updated[index].video_prompt = newPrompt;
            return updated;
        });
    };

    const handleRemoveCut = (index: number) => {
        if (storyboard.length <= 1) {
            setError('無法刪除最後一個鏡頭。至少需要保留一個鏡頭。');
            return;
        }

        showConfirm(`確定要刪除 Cut #${storyboard[index].cut} 嗎？`, () => {
            // Use functional updates to avoid closure issues
            setStoryboard(prevStoryboard => {
                const updatedStoryboard = prevStoryboard.filter((_, i) => i !== index);
                // Renumber the remaining cuts
                const renumberedStoryboard = updatedStoryboard.map((cut, i) => ({
                    ...cut,
                    cut: i + 1
                }));
                return renumberedStoryboard;
            });

            setNumCuts(prev => Math.max(1, prev - 1));

            // Also update video arrays to maintain sync
            setGeneratedVideos(prevVideos => {
                if (prevVideos.length > 0) {
                    return prevVideos.filter((_, i) => i !== index);
                }
                return prevVideos;
            });

            setVideoBlobUrls(prevBlobUrls => {
                if (prevBlobUrls.length > 0) {
                    // Revoke the blob URL being removed to free memory
                    if (prevBlobUrls[index] && prevBlobUrls[index].startsWith('blob:')) {
                        URL.revokeObjectURL(prevBlobUrls[index]);
                    }
                    return prevBlobUrls.filter((_, i) => i !== index);
                }
                return prevBlobUrls;
            });

            setVideoVersions(prevVersions => {
                if (prevVersions.length > 0) {
                    return prevVersions.filter((_, i) => i !== index);
                }
                return prevVersions;
            });

            // Clear merged video as it's now outdated
            if (mergedVideoUrl) {
                URL.revokeObjectURL(mergedVideoUrl);
                setMergedVideoUrl(null);
            }

            setConfirmDialog(null);
        });
    };

    // Handle image replacement
    const handleReplaceImage = (index: number, file: File) => {
        if (!file) return;

        const reader = new FileReader();
        reader.onload = async (e) => {
            const dataUrl = e.target?.result as string;

            try {
                // Crop the new image to match the aspect ratio
                const croppedDataUrl = await cropImageToAspectRatio(dataUrl, aspectRatio);

                // Update the storyboard with the new image
                setStoryboard(prevStoryboard => {
                    const updated = [...prevStoryboard];
                    updated[index].generated_image = croppedDataUrl;
                    return updated;
                });

                // Determine which videos need to be regenerated
                const affectedVideos: number[] = [];
                // Current cut's video uses this image as start image
                if (index < storyboard.length) {
                    affectedVideos.push(index);
                }
                // Previous cut's video uses this image as end image (if not the first cut)
                if (index > 0 && index - 1 < videoBlobUrls.length && videoBlobUrls[index - 1]) {
                    affectedVideos.push(index - 1);
                }

                // Clear affected video blob URLs
                if (affectedVideos.length > 0) {
                    // Collect blob URLs to revoke later
                    const blobUrlsToRevoke: string[] = [];

                    setVideoBlobUrls(prevBlobUrls => {
                        const updated = [...prevBlobUrls];
                        affectedVideos.forEach(videoIndex => {
                            if (updated[videoIndex] && updated[videoIndex].startsWith('blob:')) {
                                blobUrlsToRevoke.push(updated[videoIndex]);
                            }
                            updated[videoIndex] = ''; // Clear the blob URL
                        });
                        return updated;
                    });

                    // Revoke blob URLs after a delay to prevent ERR_FILE_NOT_FOUND
                    blobUrlsToRevoke.forEach(url => {
                        setTimeout(() => {
                            URL.revokeObjectURL(url);
                        }, 2000);
                    });

                    setGeneratedVideos(prevVideos => {
                        const updated = [...prevVideos];
                        affectedVideos.forEach(videoIndex => {
                            updated[videoIndex] = ''; // Clear the ComfyUI URL
                        });
                        return updated;
                    });

                    // Increment version to force re-render
                    setVideoVersions(prevVersions => {
                        const updated = [...prevVersions];
                        affectedVideos.forEach(videoIndex => {
                            updated[videoIndex] = (updated[videoIndex] || 0) + 1;
                        });
                        return updated;
                    });

                    // Clear merged video as it's now outdated
                    if (mergedVideoUrl) {
                        URL.revokeObjectURL(mergedVideoUrl);
                        setMergedVideoUrl(null);
                    }
                }

                const affectedMsg = affectedVideos.length > 0
                    ? ` 受影響的影片: ${affectedVideos.map(i => `Cut ${i + 1}`).join(', ')}`
                    : '';

                showNotification(`圖片已更換！${affectedMsg} 請重新生成受影響的影片。`, 'success');

            } catch (error: any) {
                console.error('Failed to replace image:', error);
                setError(`圖片更換失敗: ${error.message}`);
            }
        };
        reader.onerror = () => {
            setError('圖片讀取失敗');
        };
        reader.readAsDataURL(file);
    };

    // Trigger file input for image replacement
    const triggerImageReplace = (index: number) => {
        const input = document.getElementById(`replace-image-input-${index}`) as HTMLInputElement;
        if (input) {
            input.click();
        }
    };

    const dataURLtoFile = (dataurl: string, filename: string): File => {
        const arr = dataurl.split(',');
        const mimeMatch = arr[0].match(/:(.*?);/);
        if (!mimeMatch) throw new Error('Invalid data URL');
        const mime = mimeMatch[1];
        const bstr = atob(arr[1]);
        let n = bstr.length;
        const u8arr = new Uint8Array(n);
        while (n--) {
            u8arr[n] = bstr.charCodeAt(n);
        }
        return new File([u8arr], filename, { type: mime });
    }

    const handleSaveProject = async () => {
        if (!initialImage) {
            setError('沒有可儲存的專案。請先上傳圖片。');
            return;
        }

        try {
            const zip = new JSZip();

            // Save project metadata
            const projectData = {
                aspectRatio,
                outline,
                numCuts,
                storyboard: storyboard.map(cut => ({
                    cut: cut.cut,
                    image_prompt: cut.image_prompt,
                    video_prompt: cut.video_prompt
                }))
            };
            zip.file("project.json", JSON.stringify(projectData, null, 2));

            // Save initial image
            if (initialImage.dataUrl) {
                const blob = await base64ToBlob(initialImage.dataUrl);
                zip.file("initial_image.png", blob);
            }

            // Save all generated images
            for (const cut of storyboard) {
                if (cut.generated_image) {
                    const blob = await base64ToBlob(cut.generated_image);
                    zip.file(`cut_${cut.cut}.png`, blob);
                }
            }

            // Generate and download ZIP
            const content = await zip.generateAsync({ type: "blob" });
            const link = document.createElement('a');
            link.href = URL.createObjectURL(content);
            link.download = 'ai-storyboard-project.zip';
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            showNotification('專案儲存成功！', 'success');
        } catch (err: any) {
            console.error("Failed to save project:", err);
            setError(`儲存專案失敗: ${err.message}`);
        }
    };

    const handleSaveVideoProject = async () => {
        if (!initialImage) {
            setError('沒有可儲存的專案。請先上傳圖片。');
            return;
        }

        try {
            setIsLoading(true);
            setLoadingMessage(generatedVideos.length > 0 ? '正在儲存專案...' : '正在儲存專案（不含影片）...');

            const zip = new JSZip();

            // Save project metadata with video information
            const projectData: any = {
                version: '2.0', // Version 2.0 includes video support
                aspectRatio,
                outline,
                numCuts,
                storyboard: storyboard.map(cut => ({
                    cut: cut.cut,
                    image_prompt: cut.image_prompt,
                    video_prompt: cut.video_prompt
                }))
            };

            // Only include videos if they exist
            if (generatedVideos.length > 0) {
                projectData.videos = generatedVideos.map((url, index) => ({
                    index,
                    url: url, // Save ComfyUI URL
                    hasFile: saveVideosInProject // Indicate if video file is included
                }));
            }

            zip.file("video_project.json", JSON.stringify(projectData, null, 2));

            // Save initial image
            if (initialImage.dataUrl) {
                const blob = await base64ToBlob(initialImage.dataUrl);
                zip.file("initial_image.png", blob);
            }

            // Save all generated images
            for (const cut of storyboard) {
                if (cut.generated_image) {
                    const blob = await base64ToBlob(cut.generated_image);
                    zip.file(`cut_${cut.cut}.png`, blob);
                }
            }

            // Save videos if option is enabled and videos exist
            if (saveVideosInProject && generatedVideos.length > 0) {
                setLoadingMessage('正在下載並打包影片...');
                for (let i = 0; i < generatedVideos.length; i++) {
                    setLoadingMessage(`正在處理影片 ${i + 1} / ${generatedVideos.length}...`);
                    try {
                        const videoBlob = await downloadVideoFromURL(generatedVideos[i]);
                        zip.file(`video_${i + 1}.mp4`, videoBlob);
                    } catch (e: any) {
                        console.error(`Failed to download video ${i + 1}:`, e);
                        // Continue with other videos even if one fails
                    }
                }
            }

            // Generate and download ZIP
            setLoadingMessage('正在生成壓縮檔...');
            const content = await zip.generateAsync({ type: "blob" });
            const link = document.createElement('a');
            link.href = URL.createObjectURL(content);
            const fileName = projectName ? `${projectName}.zip` : `ai-storyboard-project-${Date.now()}.zip`;
            link.download = fileName;
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);

            let message = '專案儲存成功！';
            if (generatedVideos.length > 0) {
                message = saveVideosInProject
                    ? '專案儲存成功（包含影片檔案）！'
                    : '專案儲存成功（不含影片檔案，僅URL路徑）！';
            }
            showNotification(message, 'success');

        } catch (err: any) {
            console.error("Failed to save video project:", err);
            setError(`儲存影片專案失敗: ${err.message}`);
        } finally {
            setIsLoading(false);
            setLoadingMessage('');
        }
    };

    const handleLoadProject = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        try {
            setIsLoading(true);
            setLoadingMessage('載入專案中...');
            setError('');

            const zip = new JSZip();
            const zipData = await zip.loadAsync(file);

            // Read project.json
            const projectJsonFile = zipData.file("project.json");
            if (!projectJsonFile) {
                throw new Error('專案檔案中找不到 project.json');
            }
            const projectJsonText = await projectJsonFile.async("text");
            const projectData = JSON.parse(projectJsonText);

            if (!projectData.aspectRatio || !projectData.outline) {
                throw new Error('專案檔案格式不符或已損毀');
            }

            // Read initial image
            const initialImageFile = zipData.file("initial_image.png");
            if (!initialImageFile) {
                throw new Error('專案檔案中找不到初始圖片');
            }
            const initialImageBlob = await initialImageFile.async("blob");
            const initialImageDataUrl = await new Promise<string>((resolve) => {
                const reader = new FileReader();
                reader.onload = (e) => resolve(e.target?.result as string);
                reader.readAsDataURL(initialImageBlob);
            });

            // Read generated images
            const loadedStoryboard: any[] = [];
            for (const cutData of projectData.storyboard) {
                const cutImageFile = zipData.file(`cut_${cutData.cut}.png`);
                let generatedImage = '';

                if (cutImageFile) {
                    const cutImageBlob = await cutImageFile.async("blob");
                    generatedImage = await new Promise<string>((resolve) => {
                        const reader = new FileReader();
                        reader.onload = (e) => resolve(e.target?.result as string);
                        reader.readAsDataURL(cutImageBlob);
                    });
                }

                loadedStoryboard.push({
                    cut: cutData.cut,
                    image_prompt: cutData.image_prompt,
                    video_prompt: cutData.video_prompt,
                    generated_image: generatedImage
                });
            }

            // Set all state
            setAspectRatio(projectData.aspectRatio);
            setOutline(projectData.outline);
            setNumCuts(projectData.numCuts || 1);
            setStoryboard(loadedStoryboard);

            const loadedFile = dataURLtoFile(initialImageDataUrl, 'loaded_image.png');
            setInitialImage({ file: loadedFile, dataUrl: initialImageDataUrl });

            setError('');
            setLoadingMessage('專案載入成功！');
            setTimeout(() => setLoadingMessage(''), 2000);

        } catch (err: any) {
            console.error("Failed to load project:", err);
            setError(`載入專案失敗: ${err.message}`);
        } finally {
            setIsLoading(false);
            e.target.value = '';
        }
    };

    const handleAppendProject = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        try {
            setIsLoading(true);
            setLoadingMessage('追加專案中...');
            setError('');

            const zip = new JSZip();
            const zipData = await zip.loadAsync(file);

            // Try to read video_project.json (v2.0) first, fallback to project.json (v1.0)
            let projectJsonFile = zipData.file("video_project.json");
            let isVideoProject = true;

            if (!projectJsonFile) {
                projectJsonFile = zipData.file("project.json");
                isVideoProject = false;
            }

            if (!projectJsonFile) {
                throw new Error('專案檔案中找不到 project.json 或 video_project.json');
            }

            const projectJsonText = await projectJsonFile.async("text");
            const projectData = JSON.parse(projectJsonText);

            if (!projectData.storyboard || projectData.storyboard.length === 0) {
                throw new Error('專案檔案中沒有分鏡資料');
            }

            // Read generated images from the append project
            const appendedStoryboard: any[] = [];
            const currentCutCount = storyboard.length;

            for (let i = 0; i < projectData.storyboard.length; i++) {
                const cutData = projectData.storyboard[i];
                const cutImageFile = zipData.file(`cut_${cutData.cut}.png`);
                let generatedImage = '';

                if (cutImageFile) {
                    const cutImageBlob = await cutImageFile.async("blob");
                    generatedImage = await new Promise<string>((resolve) => {
                        const reader = new FileReader();
                        reader.onload = (e) => resolve(e.target?.result as string);
                        reader.readAsDataURL(cutImageBlob);
                    });
                }

                appendedStoryboard.push({
                    cut: currentCutCount + i + 1, // Renumber cuts
                    image_prompt: cutData.image_prompt,
                    video_prompt: cutData.video_prompt,
                    generated_image: generatedImage
                });
            }

            // Append to existing storyboard
            setStoryboard(prevStoryboard => [...prevStoryboard, ...appendedStoryboard]);
            setNumCuts(storyboard.length + appendedStoryboard.length);

            // Handle videos if this is a video project
            if (isVideoProject && projectData.videos && projectData.videos.length > 0) {
                setLoadingMessage('載入追加的影片中...');
                const appendedVideoUrls: string[] = [];
                const appendedVideoBlobUrls: string[] = [];
                let hasWarning = false;

                for (let i = 0; i < projectData.videos.length; i++) {
                    const videoInfo = projectData.videos[i];
                    const videoFile = zipData.file(`video_${i + 1}.mp4`);

                    if (videoFile) {
                        // Video file exists in ZIP, load it
                        setLoadingMessage(`載入追加影片 ${i + 1} / ${projectData.videos.length}...`);
                        const videoBlob = await videoFile.async("blob");
                        const blobUrl = URL.createObjectURL(videoBlob);
                        appendedVideoBlobUrls.push(blobUrl);
                        appendedVideoUrls.push(videoInfo.url || blobUrl);
                    } else if (videoInfo.url) {
                        // No file in ZIP, try to use the URL
                        hasWarning = true;
                        appendedVideoUrls.push(videoInfo.url);
                        // Try to load from URL
                        try {
                            const blob = await downloadVideoFromURL(videoInfo.url);
                            const blobUrl = URL.createObjectURL(blob);
                            appendedVideoBlobUrls.push(blobUrl);
                        } catch (e) {
                            console.error(`Failed to load video from URL: ${videoInfo.url}`, e);
                            appendedVideoBlobUrls.push(''); // Empty placeholder
                        }
                    }
                }

                // Append videos to existing arrays
                setGeneratedVideos(prevVideos => [...prevVideos, ...appendedVideoUrls]);
                setVideoBlobUrls(prevBlobUrls => [...prevBlobUrls, ...appendedVideoBlobUrls]);
                setVideoVersions(prevVersions => [...prevVersions, ...appendedVideoUrls.map((_, i) => 1)]);

                // Clear merged video as it needs to be regenerated
                if (mergedVideoUrl) {
                    URL.revokeObjectURL(mergedVideoUrl);
                    setMergedVideoUrl(null);
                }

                if (hasWarning) {
                    showNotification('⚠️ 部分影片從本地路徑載入。如果 ComfyUI 已重啟，這些路徑可能已失效。', 'info');
                }

                showNotification(`專案已追加！新增 ${appendedStoryboard.length} 個 Cuts，${appendedVideoUrls.length} 個影片。`, 'success');
            } else {
                // No videos in append project
                showNotification(`專案已追加！新增 ${appendedStoryboard.length} 個 Cuts（無影片）。請生成影片。`, 'info');
            }

        } catch (err: any) {
            console.error("Failed to append project:", err);
            setError(`追加專案失敗: ${err.message}`);
        } finally {
            setIsLoading(false);
            e.target.value = '';
        }
    };

    const handleLoadVideoProject = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        try {
            setIsLoading(true);
            setLoadingMessage('載入影片專案中...');
            setError('');

            // Clean up old blob URLs
            videoBlobUrls.forEach(url => {
                if (url.startsWith('blob:')) {
                    URL.revokeObjectURL(url);
                }
            });
            setVideoBlobUrls([]);
            setGeneratedVideos([]);
            setVideoVersions([]);
            if (mergedVideoUrl) {
                URL.revokeObjectURL(mergedVideoUrl);
                setMergedVideoUrl(null);
            }

            const zip = new JSZip();
            const zipData = await zip.loadAsync(file);

            // Try to read video_project.json (v2.0) first, fallback to project.json (v1.0)
            let projectJsonFile = zipData.file("video_project.json");
            let isVideoProject = true;

            if (!projectJsonFile) {
                projectJsonFile = zipData.file("project.json");
                isVideoProject = false;
            }

            if (!projectJsonFile) {
                throw new Error('專案檔案中找不到 project.json 或 video_project.json');
            }

            const projectJsonText = await projectJsonFile.async("text");
            const projectData = JSON.parse(projectJsonText);

            if (!projectData.aspectRatio || !projectData.outline) {
                throw new Error('專案檔案格式不符或已損毀');
            }

            // Read initial image
            const initialImageFile = zipData.file("initial_image.png");
            if (!initialImageFile) {
                throw new Error('專案檔案中找不到初始圖片');
            }
            const initialImageBlob = await initialImageFile.async("blob");
            const initialImageDataUrl = await new Promise<string>((resolve) => {
                const reader = new FileReader();
                reader.onload = (e) => resolve(e.target?.result as string);
                reader.readAsDataURL(initialImageBlob);
            });

            // Read generated images
            const loadedStoryboard: any[] = [];
            for (const cutData of projectData.storyboard) {
                const cutImageFile = zipData.file(`cut_${cutData.cut}.png`);
                let generatedImage = '';

                if (cutImageFile) {
                    const cutImageBlob = await cutImageFile.async("blob");
                    generatedImage = await new Promise<string>((resolve) => {
                        const reader = new FileReader();
                        reader.onload = (e) => resolve(e.target?.result as string);
                        reader.readAsDataURL(cutImageBlob);
                    });
                }

                loadedStoryboard.push({
                    cut: cutData.cut,
                    image_prompt: cutData.image_prompt,
                    video_prompt: cutData.video_prompt,
                    generated_image: generatedImage
                });
            }

            // Load videos if this is a video project
            if (isVideoProject && projectData.videos && projectData.videos.length > 0) {
                setLoadingMessage('載入影片中...');
                const loadedVideoUrls: string[] = [];
                const loadedVideoBlobUrls: string[] = [];
                let hasWarning = false;

                for (let i = 0; i < projectData.videos.length; i++) {
                    const videoInfo = projectData.videos[i];
                    const videoFile = zipData.file(`video_${i + 1}.mp4`);

                    if (videoFile) {
                        // Video file exists in ZIP, load it
                        setLoadingMessage(`載入影片 ${i + 1} / ${projectData.videos.length}...`);
                        const videoBlob = await videoFile.async("blob");
                        const blobUrl = URL.createObjectURL(videoBlob);
                        loadedVideoBlobUrls.push(blobUrl);
                        // Use the saved URL or blob URL as fallback
                        loadedVideoUrls.push(videoInfo.url || blobUrl);
                    } else if (videoInfo.url) {
                        // No file in ZIP, try to use the URL
                        hasWarning = true;
                        loadedVideoUrls.push(videoInfo.url);
                        // Try to load from URL
                        try {
                            const blob = await downloadVideoFromURL(videoInfo.url);
                            const blobUrl = URL.createObjectURL(blob);
                            loadedVideoBlobUrls.push(blobUrl);
                        } catch (e) {
                            console.error(`Failed to load video from URL: ${videoInfo.url}`, e);
                            loadedVideoBlobUrls.push(''); // Empty placeholder
                        }
                    }
                }

                setGeneratedVideos(loadedVideoUrls);
                setVideoBlobUrls(loadedVideoBlobUrls);
                setVideoVersions(loadedVideoUrls.map((_, i) => 1)); // Initialize versions

                if (hasWarning) {
                    showNotification('⚠️ 部分影片從本地路徑載入。如果 ComfyUI 已重啟，這些路徑可能已失效。', 'info');
                }
            } else {
                // No videos in project, reset video states
                setVideoVersions([]);
            }

            // Set all state
            setAspectRatio(projectData.aspectRatio);
            setOutline(projectData.outline);
            setNumCuts(projectData.numCuts || 1);
            setStoryboard(loadedStoryboard);

            const loadedFile = dataURLtoFile(initialImageDataUrl, 'loaded_image.png');
            setInitialImage({ file: loadedFile, dataUrl: initialImageDataUrl });

            setError('');
            const message = isVideoProject ? '影片專案載入成功！' : '專案載入成功（舊版格式，不含影片）！';
            showNotification(message, 'success');

        } catch (err: any) {
            console.error("Failed to load video project:", err);
            setError(`載入專案失敗: ${err.message}`);
        } finally {
            setIsLoading(false);
            e.target.value = '';
        }
    };

    const handleRegenerateImages = async () => {
        if (!initialImage || !processedImage || storyboard.length === 0) {
            setError('必須先有分鏡腳本才能重新生成圖片。');
            return;
        }
        setIsLoading(true);
        setError('');
        try {
            const tempStoryboard = [...storyboard];
            const initialImagePart = {
                inlineData: {
                    data: processedImage.split(',')[1],
                    mimeType: 'image/png',
                }
            };
            for (let i = 0; i < tempStoryboard.length; i++) {
                const promptData = tempStoryboard[i];
                setLoadingMessage(`正在重新生成第 ${i + 1} / ${tempStoryboard.length} 張分鏡圖...`);
                tempStoryboard[i].generated_image = '';
                setStoryboard([...tempStoryboard]);
                const imageResponse = await ai.models.generateContent({
                    model: 'gemini-2.5-flash-image',
                    contents: { parts: [initialImagePart, { text: promptData.image_prompt }] },
                    config: { responseModalities: [Modality.IMAGE] },
                });
                let generatedImageBase64 = '';
                const parts = imageResponse?.candidates?.[0]?.content?.parts;
                if (parts) {
                    for (const part of parts) {
                        if (part.inlineData) {
                            generatedImageBase64 = part.inlineData.data;
                            break;
                        }
                    }
                }
                if (!generatedImageBase64) {
                    const feedback = imageResponse?.promptFeedback;
                    const blockReason = feedback?.blockReason;
                    console.warn(`Cut ${i + 1} 未能生成圖片。原因: ${blockReason || '未知錯誤'}`);
                }
                tempStoryboard[i].generated_image = generatedImageBase64 ? `data:image/png;base64,${generatedImageBase64}` : '';
                setStoryboard([...tempStoryboard]);
            }
        } catch (e: any) {
            console.error(e);
            setError(`圖片生成失敗: ${e.message}`);
        } finally {
            setIsLoading(false);
            setLoadingMessage('');
        }
    };

    const handleGenerate = async () => {
        if (!initialImage || !processedImage || !outline || numCuts <= 0) {
            setError('請確保已上傳圖片、填寫大綱並設定有效的 Cut 數量。');
            return;
        }
        setIsLoading(true);
        setError('');
        setStoryboard([]);
        
        try {
            const baseImageForGeneration = processedImage;
            setLoadingMessage('正在分析大綱並產生腳本...');
            const jsonPrompt = `你是一個專業的電影導演和分鏡師。根據以下故事大綱和指定的cut數量，為每一cut產生一個JSON物件。
每一cut的JSON物件都應包含 'image_prompt' 和 'video_prompt'。

- 'image_prompt': 這是用來生成該cut靜態圖片的提示詞。風格要求為具有真實感的 "Raw photo"，請強調自然光影、細膩紋理與電影感。請專注於描述一個動作「正要開始」的瞬間，捕捉角色蓄勢待發的姿態或事件即將發生的緊張感。需要詳細描述場景、角色、構圖和氛圍，並參考初始圖片風格。
- 'video_prompt': 這是用來生成該cut動態影片的提示詞。接續 'image_prompt' 的畫面，完整地演繹接下來發生的動作。描述影片的開始與結束畫面，並包含運鏡指示（如 pan, tilt, zoom in/out, dolly），確保影片能與前一cut和後一cut的內容流暢銜接。

故事大綱: "${outline}"
Cut總數: ${numCuts}
長寬比: "${aspectRatio}"

請嚴格遵循JSON格式，輸出一個包含 ${numCuts} 個物件的JSON陣列。`;
            
            const response = await ai.models.generateContent({
                model: "gemini-2.5-flash",
                contents: jsonPrompt,
                config: {
                    responseMimeType: "application/json",
                    responseSchema: {
                        type: Type.ARRAY,
                        items: {
                            type: Type.OBJECT,
                            properties: {
                                image_prompt: { type: Type.STRING },
                                video_prompt: { type: Type.STRING },
                            },
                            required: ["image_prompt", "video_prompt"]
                        }
                    }
                }
            });

            const text = response.text;
            if (!text) {
                const feedback = response?.promptFeedback;
                const blockReason = feedback?.blockReason;
                throw new Error(`API 未能生成有效的腳本。原因: ${blockReason || 'API 返回了空的回應'}`);
            }
            const generatedPrompts = JSON.parse(text);

            if (!Array.isArray(generatedPrompts) || generatedPrompts.length === 0) {
                throw new Error("API 未能生成有效的腳本，請調整大綱後再試。");
            }

            const tempStoryboard: any[] = [];
            const initialImagePart = {
                inlineData: {
                    data: baseImageForGeneration.split(',')[1],
                    mimeType: 'image/png',
                }
            };

            for (let i = 0; i < generatedPrompts.length; i++) {
                const promptData = generatedPrompts[i];
                setLoadingMessage(`正在生成第 ${i + 1} / ${generatedPrompts.length} 張分鏡圖...`);

                const imageResponse = await ai.models.generateContent({
                    model: 'gemini-2.5-flash-image',
                    contents: { parts: [initialImagePart, { text: promptData.image_prompt }] },
                    config: {
                        responseModalities: [Modality.IMAGE],
                    },
                });

                let generatedImageBase64 = '';
                const parts = imageResponse?.candidates?.[0]?.content?.parts;
                if (parts) {
                    for (const part of parts) {
                        if (part.inlineData) {
                            generatedImageBase64 = part.inlineData.data;
                            break;
                        }
                    }
                }

                if (!generatedImageBase64) {
                    const feedback = imageResponse?.promptFeedback;
                    const blockReason = feedback?.blockReason;
                    console.warn(`Cut ${i + 1} 未能生成圖片。原因: ${blockReason || '未知錯誤'}`);
                }

                tempStoryboard.push({
                    cut: i + 1,
                    image_prompt: promptData.image_prompt,
                    video_prompt: promptData.video_prompt,
                    generated_image: generatedImageBase64 ? `data:image/png;base64,${generatedImageBase64}` : ''
                });
                setStoryboard([...tempStoryboard]);
            }

        } catch (e: any) {
            console.error(e);
            setError(`生成失敗: ${e.message}`);
        } finally {
            setIsLoading(false);
            setLoadingMessage('');
        }
    };
    
    const handleImageUpload = (file: File) => {
        const reader = new FileReader();
        reader.onload = (e) => {
            const dataUrl = e.target?.result as string;
            setStoryboard([]);
            setError('');
            setInitialImage({ file, dataUrl });
        };
        reader.readAsDataURL(file);
    };

    const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (file) handleImageUpload(file);
    };

    const handleAspectRatioChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        setAspectRatio(e.target.value);
    };
    
    const base64ToBlob = async (base64: string, type = 'image/png') => {
        const res = await fetch(base64);
        return await res.blob();
    };

    const handleCopy = (text: string, index: number) => {
        navigator.clipboard.writeText(text).then(() => {
            setCopiedStates(prev => ({ ...prev, [index]: true }));
            setTimeout(() => {
                setCopiedStates(prev => ({ ...prev, [index]: false }));
            }, 1500);
        });
    };

    const setupDragAndDrop = () => {
        const uploadArea = uploadAreaRef.current;
        if (!uploadArea) return;

        const onDragOver = (e: DragEvent) => {
            e.preventDefault();
            uploadArea.classList.add('drag-over');
        };
        const onDragLeave = () => uploadArea.classList.remove('drag-over');
        const onDrop = (e: DragEvent) => {
            e.preventDefault();
            uploadArea.classList.remove('drag-over');
            const file = e.dataTransfer?.files?.[0];
            if (file) handleImageUpload(file);
        };

        uploadArea.addEventListener('dragover', onDragOver);
        uploadArea.addEventListener('dragleave', onDragLeave);
        uploadArea.addEventListener('drop', onDrop);

        return () => {
            if (uploadArea) {
                uploadArea.removeEventListener('dragover', onDragOver);
                uploadArea.removeEventListener('dragleave', onDragLeave);
                uploadArea.removeEventListener('drop', onDrop);
            }
        };
    };
    useEffect(setupDragAndDrop, [uploadAreaRef.current]);

    // Cleanup blob URLs when component unmounts or videos change
    useEffect(() => {
        return () => {
            // Revoke all blob URLs to free memory
            videoBlobUrls.forEach(url => {
                if (url.startsWith('blob:')) {
                    URL.revokeObjectURL(url);
                }
            });
        };
    }, [videoBlobUrls]);

    const isFormValid = initialImage && outline && numCuts > 0;

    return (
        <div className="container">
            <div className="header">
                <h1>AI 分鏡稿產生器</h1>
                <button className="btn btn-settings" onClick={() => setShowSettings(true)} title="設定">
                    ⚙️
                </button>
            </div>

            {showSettings && (
                <div className="modal-overlay" onClick={() => setShowSettings(false)}>
                    <div className="modal-content" onClick={(e) => e.stopPropagation()}>
                        <h2>設定</h2>
                        <div className="settings-form">
                            <div className="form-group">
                                <label>專案名稱 (選填)</label>
                                <input
                                    type="text"
                                    value={projectName}
                                    onChange={(e) => setProjectName(e.target.value)}
                                    placeholder="輸入專案名稱（用於儲存檔名）"
                                />
                                <small style={{color: '#888', fontSize: '0.85em', display: 'block', marginTop: '5px'}}>
                                    儲存專案時將使用此名稱作為檔名，留空則使用時間戳記
                                </small>
                            </div>
                            <div className="form-group">
                                <label>API Key (選填)</label>
                                <input
                                    type="password"
                                    value={apiKey}
                                    onChange={(e) => setApiKey(e.target.value)}
                                    placeholder="輸入 Google Gemini API Key"
                                />
                            </div>
                            <div className="form-group">
                                <label>ComfyUI URL</label>
                                <input
                                    type="text"
                                    value={comfyUIUrl}
                                    onChange={(e) => setComfyUIUrl(e.target.value)}
                                    placeholder="http://127.0.0.1:8188"
                                />
                            </div>
                            <div className="form-group">
                                <label>工作流名稱</label>
                                <input
                                    type="text"
                                    value={workflowName}
                                    onChange={(e) => setWorkflowName(e.target.value)}
                                    placeholder="WanSE.json"
                                />
                            </div>
                            <div className="form-group">
                                <label>起始幀節點 (StartFrame)</label>
                                <input
                                    type="text"
                                    value={startFrameNode}
                                    onChange={(e) => setStartFrameNode(e.target.value)}
                                    placeholder="68"
                                />
                            </div>
                            <div className="form-group">
                                <label>結束幀節點 (EndFrame)</label>
                                <input
                                    type="text"
                                    value={endFrameNode}
                                    onChange={(e) => setEndFrameNode(e.target.value)}
                                    placeholder="62"
                                />
                            </div>
                            <div className="form-group">
                                <label>提示詞節點</label>
                                <input
                                    type="text"
                                    value={promptNode}
                                    onChange={(e) => setPromptNode(e.target.value)}
                                    placeholder="6"
                                />
                            </div>
                            <div className="form-group">
                                <label>SaveVideo 節點</label>
                                <input
                                    type="text"
                                    value={saveVideoNode}
                                    onChange={(e) => setSaveVideoNode(e.target.value)}
                                    placeholder="107"
                                />
                            </div>
                            <div className="form-group">
                                <label>影片解析度 (長邊尺寸)</label>
                                <input
                                    type="number"
                                    value={videoResolution}
                                    onChange={(e) => setVideoResolution(parseInt(e.target.value) || 512)}
                                    placeholder="512"
                                    min="256"
                                    max="2048"
                                    step="64"
                                />
                                <small style={{color: '#888', fontSize: '0.85em'}}>
                                    建議值: 512, 768, 1024 (必須是64的倍數)
                                </small>
                            </div>
                            <div className="form-group">
                                <label style={{display: 'flex', alignItems: 'center', gap: '10px', cursor: 'pointer'}}>
                                    <input
                                        type="checkbox"
                                        checked={saveVideosInProject}
                                        onChange={(e) => setSaveVideosInProject(e.target.checked)}
                                        style={{cursor: 'pointer'}}
                                    />
                                    <span>儲存影片專案時包含影片檔案</span>
                                </label>
                                <small style={{color: '#888', fontSize: '0.85em', display: 'block', marginTop: '5px', marginLeft: '30px'}}>
                                    ⚠️ 如果不勾選，將只儲存 ComfyUI URL 路徑。注意：URL 可能會在 ComfyUI 重啟後失效。
                                </small>
                            </div>

                            {/* Preset Management */}
                            <div className="form-group" style={{marginTop: '20px', paddingTop: '20px', borderTop: '1px solid #444'}}>
                                <label style={{fontSize: '1.1em', fontWeight: 'bold', marginBottom: '10px'}}>設定範本管理</label>
                                <div style={{display: 'flex', gap: '10px', marginBottom: '10px'}}>
                                    <button className="btn btn-secondary" onClick={() => setShowPresetModal(true)}>
                                        💾 儲存為範本
                                    </button>
                                </div>

                                {savedPresets.length > 0 && (
                                    <div style={{marginTop: '15px'}}>
                                        <small style={{color: '#888', display: 'block', marginBottom: '8px'}}>
                                            已儲存的範本 ({savedPresets.length}):
                                        </small>
                                        <div style={{display: 'flex', flexDirection: 'column', gap: '8px'}}>
                                            {savedPresets.map((preset, index) => (
                                                <div key={index} style={{
                                                    display: 'flex',
                                                    justifyContent: 'space-between',
                                                    alignItems: 'center',
                                                    padding: '8px 12px',
                                                    backgroundColor: '#2a2a2a',
                                                    borderRadius: '4px'
                                                }}>
                                                    <div>
                                                        <div style={{fontWeight: 'bold'}}>{preset.name}</div>
                                                        <small style={{color: '#888'}}>
                                                            {preset.workflowName} | {preset.videoResolution}p
                                                        </small>
                                                    </div>
                                                    <div style={{display: 'flex', gap: '5px'}}>
                                                        <button
                                                            className="btn btn-small"
                                                            onClick={() => handleLoadPreset(preset)}
                                                            style={{padding: '4px 8px', fontSize: '0.85em'}}
                                                        >
                                                            載入
                                                        </button>
                                                        <button
                                                            className="btn btn-small"
                                                            onClick={() => handleDeletePreset(index)}
                                                            style={{padding: '4px 8px', fontSize: '0.85em', backgroundColor: '#d32f2f'}}
                                                        >
                                                            刪除
                                                        </button>
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                )}
                            </div>

                            <div className="modal-actions">
                                <button className="btn btn-primary" onClick={handleSaveSettings}>儲存設定</button>
                                <button className="btn btn-secondary" onClick={() => setShowSettings(false)}>取消</button>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            <div className="input-section">
                <div className="form-group">
                    <label htmlFor="file-upload">1. 上傳初始圖片</label>
                    <div ref={uploadAreaRef} className="upload-area" onClick={() => document.getElementById('file-upload')?.click()}>
                        <input type="file" id="file-upload" accept="image/*" onChange={handleFileChange} />
                        <p>點擊或拖曳圖片至此處</p>
                        {processedImage && <img src={processedImage} alt="Preview" className="image-preview" />}
                    </div>
                </div>
                <div className="form-group">
                    <label>2. 選擇長寬比</label>
                    <div className="radio-group">
                        <input type="radio" id="16-9" name="aspectRatio" value="16:9" checked={aspectRatio === '16:9'} onChange={handleAspectRatioChange} />
                        <label htmlFor="16-9">16:9</label>
                        <input type="radio" id="9-16" name="aspectRatio" value="9:16" checked={aspectRatio === '9:16'} onChange={handleAspectRatioChange} />
                        <label htmlFor="9-16">9:16</label>
                    </div>
                </div>
                <div className="form-group">
                    <label htmlFor="outline">3. 輸入故事大綱</label>
                    <textarea id="outline" value={outline} onChange={e => setOutline(e.target.value)} placeholder="例：一位太空人迷失在一顆陌生的紅色星球上，發現了古老文明的遺跡。"></textarea>
                </div>
                <div className="form-group">
                    <label htmlFor="num-cuts">4. 設定 Cut 數量</label>
                    <input type="number" id="num-cuts" value={numCuts} onChange={e => setNumCuts(parseInt(e.target.value, 10) || 1)} min="1" />
                </div>
                <button className="btn btn-primary" onClick={handleGenerate} disabled={!isFormValid || isLoading}>
                    {isLoading ? '生成中...' : '生成分鏡'}
                </button>
                <div className="project-actions">
                    <button className="btn btn-secondary" onClick={handleSaveVideoProject} disabled={!initialImage} title="儲存專案（可在設定中選擇是否包含影片檔案）">儲存專案</button>
                    <input type="file" id="load-video-project-input" accept=".zip" onChange={handleLoadVideoProject} style={{ display: 'none' }} />
                    <label htmlFor="load-video-project-input" className="btn btn-secondary" title="支援載入新版和舊版專案">載入專案</label>

                    <input type="file" id="append-project-input" accept=".zip" onChange={handleAppendProject} style={{ display: 'none' }} />
                    <label htmlFor="append-project-input" className="btn btn-secondary" title="追加專案到現有專案之後" style={{display: storyboard.length > 0 ? 'inline-block' : 'none'}}>追加專案</label>
                </div>
            </div>
            
            {error && <div className="error-message">{error}</div>}

            {isLoading && (
                <div className="loading-section">
                    <div className="spinner"></div>
                    <p className="loading-message">{loadingMessage}</p>
                </div>
            )}
            
            {storyboard.length > 0 && !isLoading && (
                 <div className="result-section">
                    <div className="result-header">
                        <button className="btn" onClick={handleRegenerateImages} disabled={isLoading}>重新生成圖片</button>
                        <button
                            className="btn btn-success"
                            onClick={handleGenerateVideos}
                            disabled={isGeneratingVideo || storyboard.some(cut => !cut.generated_image)}
                            title={storyboard.some(cut => !cut.generated_image) ? '請先生成所有圖片' : '生成影片'}
                        >
                            {isGeneratingVideo ? '生成影片中...' : '生成影片'}
                        </button>
                        {videoBlobUrls.length > 0 && (
                            <>
                                <button
                                    className="btn btn-preview"
                                    onClick={() => {
                                        // Find first valid video index
                                        const firstValidIndex = videoBlobUrls.findIndex(url => url && url.length > 0);
                                        if (firstValidIndex >= 0) {
                                            setCurrentPreviewIndex(firstValidIndex);
                                            setShowVideoPreview(true);
                                        } else {
                                            showNotification('沒有可預覽的影片', 'info');
                                        }
                                    }}
                                    disabled={isMergingVideos}
                                >
                                    預覽影片
                                </button>
                                <button
                                    className="btn btn-merge"
                                    onClick={() => mergeVideos(false)}
                                    disabled={isMergingVideos || generatedVideos.length === 0}
                                >
                                    {isMergingVideos ? '合併中...' : '重新合併影片'}
                                </button>
                            </>
                        )}
                    </div>
                    {videoBlobUrls.length > 0 && (
                        <div className="batch-regenerate-controls">
                            <div className="selection-info">
                                已選擇 {selectedVideos.size} 個影片
                            </div>
                            <div className="batch-buttons">
                                <button
                                    className="btn btn-secondary"
                                    onClick={selectAllVideos}
                                    disabled={isRegeneratingSelected || isGeneratingVideo}
                                >
                                    全選
                                </button>
                                <button
                                    className="btn btn-secondary"
                                    onClick={deselectAllVideos}
                                    disabled={isRegeneratingSelected || isGeneratingVideo || selectedVideos.size === 0}
                                >
                                    取消全選
                                </button>
                                <button
                                    className="btn btn-regenerate-batch"
                                    onClick={handleRegenerateSelected}
                                    disabled={isRegeneratingSelected || isGeneratingVideo || selectedVideos.size === 0}
                                >
                                    {isRegeneratingSelected ? '⟳ 重新生成中...' : `🎬 重新生成選中影片 (${selectedVideos.size})`}
                                </button>
                            </div>
                        </div>
                    )}
                    {isGeneratingVideo && (
                        <div className="video-progress">
                            <div className="spinner"></div>
                            <p>{videoProgress}</p>
                        </div>
                    )}
                    {isRegeneratingSelected && (
                        <div className="video-progress">
                            <div className="spinner"></div>
                            <p>{videoProgress}</p>
                        </div>
                    )}
                    {isMergingVideos && (
                        <div className="video-progress">
                            <div className="spinner"></div>
                            <p>{mergeProgress}</p>
                        </div>
                    )}

                    {/* Merged Video Preview */}
                    {mergedVideoUrl && !isMergingVideos && (
                        <div className="merged-video-section">
                            <div className="merged-video-header">
                                <h2>最終合併影片</h2>
                                <button className="btn btn-primary" onClick={downloadMergedVideo}>
                                    下載影片
                                </button>
                            </div>
                            <div className="merged-video-container">
                                <video
                                    key={mergedVideoUrl}
                                    controls
                                    autoPlay
                                    loop
                                    className="merged-video-player"
                                >
                                    <source src={mergedVideoUrl} type="video/mp4" />
                                    Your browser does not support the video tag.
                                </video>
                            </div>
                        </div>
                    )}

                    <div className="storyboard-grid">
                        {storyboard.map((cut, index) => (
                            <div key={index} className={`cut-card ${selectedVideos.has(index) ? 'selected' : ''}`}>
                                <div className="cut-header">
                                    <h3>Cut #{cut.cut}</h3>
                                    <div className="cut-header-actions">
                                        {videoBlobUrls[index] && (
                                            <label className="video-select-label" title="選擇此影片以重新生成">
                                                <input
                                                    type="checkbox"
                                                    checked={selectedVideos.has(index)}
                                                    onChange={() => toggleVideoSelection(index)}
                                                    disabled={isRegeneratingSelected || isGeneratingVideo}
                                                    className="video-select-checkbox"
                                                />
                                                <span className="checkbox-text">選擇</span>
                                            </label>
                                        )}
                                        <button
                                            className="btn btn-delete"
                                            onClick={() => handleRemoveCut(index)}
                                            title="刪除此鏡頭"
                                            disabled={storyboard.length <= 1}
                                        >
                                            ✕
                                        </button>
                                    </div>
                                </div>
                                <div className="image-container">
                                    {cut.generated_image ?
                                        <img
                                            src={cut.generated_image}
                                            alt={`Cut ${cut.cut}`}
                                            style={{ aspectRatio: aspectRatio.replace(':', ' / ')}}
                                        /> :
                                        <div className="image-placeholder" style={{ aspectRatio: aspectRatio.replace(':', ' / ')}}>
                                            <span>{isLoading ? '生成中...' : '圖片尚未生成'}</span>
                                        </div>
                                    }
                                    {cut.generated_image && (
                                        <div className="image-overlay">
                                            <button
                                                className="btn btn-replace-image"
                                                onClick={() => triggerImageReplace(index)}
                                                title="更換此圖片"
                                            >
                                                🖼️ 更換圖片
                                            </button>
                                            <input
                                                type="file"
                                                id={`replace-image-input-${index}`}
                                                accept="image/*"
                                                style={{ display: 'none' }}
                                                onChange={(e) => {
                                                    const file = e.target.files?.[0];
                                                    if (file) {
                                                        handleReplaceImage(index, file);
                                                    }
                                                    e.target.value = ''; // Reset input to allow selecting same file again
                                                }}
                                            />
                                        </div>
                                    )}
                                </div>
                                <div className="prompt-area">
                                    <label>圖片提示詞 (可編輯)</label>
                                    <textarea
                                        className="prompt-text editable"
                                        value={cut.image_prompt}
                                        onChange={(e) => handleImagePromptChange(index, e.target.value)}
                                        rows={4}
                                        placeholder="請輸入圖片生成的詳細描述..."
                                    />
                                </div>
                                <div className="prompt-area">
                                    <label>影片提示詞 (可編輯)</label>
                                    <textarea
                                        className="prompt-text editable"
                                        value={cut.video_prompt}
                                        onChange={(e) => handleVideoPromptChange(index, e.target.value)}
                                        rows={4}
                                        placeholder="請輸入影片生成的詳細描述..."
                                    />
                                </div>
                                {videoBlobUrls[index] && (
                                    <div className="video-actions">
                                        <button
                                            className="btn btn-regenerate"
                                            onClick={() => openVideoPromptEdit(index)}
                                            disabled={regeneratingIndex === index || isGeneratingVideo}
                                            title="編輯提示詞並重新生成此影片"
                                        >
                                            {regeneratingIndex === index ? '⟳ 重新生成中...' : '🎬 重新生成影片'}
                                        </button>
                                    </div>
                                )}
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {/* Video Preview Modal */}
            {showVideoPreview && videoBlobUrls.length > 0 && videoBlobUrls[currentPreviewIndex] && videoBlobUrls[currentPreviewIndex].length > 0 && (
                <div className="modal-overlay" onClick={() => setShowVideoPreview(false)}>
                    <div className="modal-content video-preview-modal" onClick={(e) => e.stopPropagation()}>
                        <div className="video-preview-header">
                            <h2>影片預覽 ({currentPreviewIndex + 1} / {videoBlobUrls.length})</h2>
                            <button className="btn btn-close" onClick={() => setShowVideoPreview(false)}>✕</button>
                        </div>
                        <div className="video-preview-container">
                            {videoBlobUrls[currentPreviewIndex] && videoBlobUrls[currentPreviewIndex].startsWith('blob:') ? (
                                <video
                                    key={`${videoBlobUrls[currentPreviewIndex]}-v${videoVersions[currentPreviewIndex] || 1}`}
                                    controls
                                    autoPlay
                                    loop
                                    className="preview-video"
                                    src={videoBlobUrls[currentPreviewIndex]}
                                    onError={async (e) => {
                                        console.error(`Video preview error for index ${currentPreviewIndex}:`, e);
                                        console.log(`Attempting to recreate blob URL for video ${currentPreviewIndex + 1}...`);

                                        try {
                                            // Recreate blob URL from ComfyUI URL
                                            const blob = await downloadVideoFromURL(generatedVideos[currentPreviewIndex]);
                                            const newBlobUrl = URL.createObjectURL(blob);

                                            // Update the blob URL in state
                                            setVideoBlobUrls(prevBlobUrls => {
                                                const updated = [...prevBlobUrls];
                                                // Revoke old blob URL if it exists
                                                if (updated[currentPreviewIndex] && updated[currentPreviewIndex].startsWith('blob:')) {
                                                    try {
                                                        URL.revokeObjectURL(updated[currentPreviewIndex]);
                                                    } catch (err) {
                                                        console.warn('Failed to revoke old blob URL:', err);
                                                    }
                                                }
                                                updated[currentPreviewIndex] = newBlobUrl;
                                                return updated;
                                            });

                                            // Force re-render
                                            setVideoVersions(prevVersions => {
                                                const updated = [...prevVersions];
                                                updated[currentPreviewIndex] = (updated[currentPreviewIndex] || 0) + 1;
                                                return updated;
                                            });

                                            console.log(`✓ Successfully recreated blob URL for video ${currentPreviewIndex + 1}`);
                                        } catch (err) {
                                            console.error('Failed to recreate blob URL:', err);
                                            showNotification(`無法載入影片 ${currentPreviewIndex + 1}`, 'error');
                                        }
                                    }}
                                >
                                    Your browser does not support the video tag.
                                </video>
                            ) : (
                                <div style={{padding: '20px', textAlign: 'center', color: '#888'}}>
                                    <p>正在載入影片...</p>
                                    <button
                                        className="btn btn-primary"
                                        onClick={async () => {
                                            try {
                                                setIsLoading(true);
                                                setLoadingMessage(`載入影片 ${currentPreviewIndex + 1}...`);

                                                const blob = await downloadVideoFromURL(generatedVideos[currentPreviewIndex]);
                                                const newBlobUrl = URL.createObjectURL(blob);

                                                setVideoBlobUrls(prevBlobUrls => {
                                                    const updated = [...prevBlobUrls];
                                                    updated[currentPreviewIndex] = newBlobUrl;
                                                    return updated;
                                                });

                                                setVideoVersions(prevVersions => {
                                                    const updated = [...prevVersions];
                                                    updated[currentPreviewIndex] = (updated[currentPreviewIndex] || 0) + 1;
                                                    return updated;
                                                });

                                                showNotification(`影片 ${currentPreviewIndex + 1} 載入成功`, 'success');
                                            } catch (err: any) {
                                                console.error('Failed to load video:', err);
                                                showNotification(`載入失敗：${err.message}`, 'error');
                                            } finally {
                                                setIsLoading(false);
                                                setLoadingMessage('');
                                            }
                                        }}
                                    >
                                        點擊載入影片
                                    </button>
                                </div>
                            )}
                        </div>
                        <div className="video-preview-controls">
                            <button
                                className="btn btn-secondary"
                                onClick={() => {
                                    // Find previous valid video index
                                    let prevIndex = currentPreviewIndex - 1;
                                    while (prevIndex >= 0 && (!videoBlobUrls[prevIndex] || videoBlobUrls[prevIndex].length === 0)) {
                                        prevIndex--;
                                    }
                                    if (prevIndex >= 0) {
                                        setCurrentPreviewIndex(prevIndex);
                                    }
                                }}
                                disabled={(() => {
                                    let prevIndex = currentPreviewIndex - 1;
                                    while (prevIndex >= 0 && (!videoBlobUrls[prevIndex] || videoBlobUrls[prevIndex].length === 0)) {
                                        prevIndex--;
                                    }
                                    return prevIndex < 0;
                                })()}
                            >
                                ← 上一個
                            </button>
                            <span className="video-preview-info">
                                {currentPreviewIndex === storyboard.length - 1
                                    ? `Cut ${currentPreviewIndex + 1} (結尾)`
                                    : `Cut ${currentPreviewIndex + 1} → Cut ${currentPreviewIndex + 2}`}
                            </span>
                            <button
                                className="btn btn-secondary"
                                onClick={() => {
                                    // Find next valid video index
                                    let nextIndex = currentPreviewIndex + 1;
                                    while (nextIndex < videoBlobUrls.length && (!videoBlobUrls[nextIndex] || videoBlobUrls[nextIndex].length === 0)) {
                                        nextIndex++;
                                    }
                                    if (nextIndex < videoBlobUrls.length) {
                                        setCurrentPreviewIndex(nextIndex);
                                    }
                                }}
                                disabled={(() => {
                                    let nextIndex = currentPreviewIndex + 1;
                                    while (nextIndex < videoBlobUrls.length && (!videoBlobUrls[nextIndex] || videoBlobUrls[nextIndex].length === 0)) {
                                        nextIndex++;
                                    }
                                    return nextIndex >= videoBlobUrls.length;
                                })()}
                            >
                                下一個 →
                            </button>
                        </div>
                        <div className="video-preview-actions">
                            <a
                                href={generatedVideos[currentPreviewIndex]}
                                download={`video_${currentPreviewIndex + 1}.mp4`}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="btn btn-primary"
                            >
                                下載此影片
                            </a>
                            <button
                                className="btn btn-merge"
                                onClick={() => {
                                    setShowVideoPreview(false);
                                    mergeVideos();
                                }}
                            >
                                合併所有影片並下載
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Video Prompt Edit Modal */}
            {showVideoPromptEdit && editingVideoIndex !== null && (
                <div className="modal-overlay" onClick={() => setShowVideoPromptEdit(false)}>
                    <div className="modal-content" onClick={(e) => e.stopPropagation()}>
                        <h2>編輯影片提示詞 - Cut #{editingVideoIndex + 1}</h2>
                        <div className="settings-form">
                            <div className="form-group">
                                <label>影片提示詞</label>
                                <textarea
                                    value={editingVideoPrompt}
                                    onChange={(e) => setEditingVideoPrompt(e.target.value)}
                                    rows={8}
                                    placeholder="請輸入影片生成的詳細描述..."
                                    style={{ width: '100%', padding: '10px', fontSize: '14px' }}
                                />
                                <small style={{color: '#888', fontSize: '0.85em', display: 'block', marginTop: '5px'}}>
                                    修改提示詞後將重新生成此段影片，並自動重新合併所有影片。
                                </small>
                            </div>
                            <div className="modal-actions">
                                <button
                                    className="btn btn-primary"
                                    onClick={handleVideoPromptEditSubmit}
                                    disabled={!editingVideoPrompt.trim()}
                                >
                                    重新生成影片
                                </button>
                                <button
                                    className="btn btn-secondary"
                                    onClick={() => {
                                        setShowVideoPromptEdit(false);
                                        setEditingVideoIndex(null);
                                        setEditingVideoPrompt('');
                                    }}
                                >
                                    取消
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* Notification Toast */}
            {notification && (
                <div className={`notification-toast notification-${notification.type}`}>
                    <div className="notification-content">
                        <span className="notification-icon">
                            {notification.type === 'success' && '✓'}
                            {notification.type === 'error' && '✕'}
                            {notification.type === 'info' && 'ℹ'}
                        </span>
                        <span className="notification-message">{notification.message}</span>
                    </div>
                    <button className="notification-close" onClick={() => setNotification(null)}>✕</button>
                </div>
            )}

            {/* Confirm Dialog */}
            {confirmDialog && (
                <div className="modal-overlay" onClick={() => setConfirmDialog(null)}>
                    <div className="modal-content confirm-dialog" onClick={(e) => e.stopPropagation()}>
                        <h3>確認</h3>
                        <p>{confirmDialog.message}</p>
                        <div className="modal-actions">
                            <button className="btn btn-primary" onClick={confirmDialog.onConfirm}>確認</button>
                            <button className="btn btn-secondary" onClick={() => setConfirmDialog(null)}>取消</button>
                        </div>
                    </div>
                </div>
            )}

            {/* Preset Name Modal */}
            {showPresetModal && (
                <div className="modal-overlay" onClick={() => setShowPresetModal(false)}>
                    <div className="modal-content confirm-dialog" onClick={(e) => e.stopPropagation()}>
                        <h3>儲存設定範本</h3>
                        <div className="form-group">
                            <label>範本名稱</label>
                            <input
                                type="text"
                                value={presetName}
                                onChange={(e) => setPresetName(e.target.value)}
                                placeholder="例如：人物動畫、動漫風格等"
                                autoFocus
                                onKeyPress={(e) => {
                                    if (e.key === 'Enter') {
                                        handleSavePreset();
                                    }
                                }}
                            />
                        </div>
                        <div className="modal-actions">
                            <button className="btn btn-primary" onClick={handleSavePreset}>儲存</button>
                            <button className="btn btn-secondary" onClick={() => {
                                setShowPresetModal(false);
                                setPresetName('');
                            }}>取消</button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

const root = ReactDOM.createRoot(document.getElementById('root')!);
root.render(<App />);