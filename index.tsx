
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

    // Video generation state
    const [isGeneratingVideo, setIsGeneratingVideo] = useState(false);
    const [videoProgress, setVideoProgress] = useState('');
    const [generatedVideos, setGeneratedVideos] = useState<string[]>([]);

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
    const mergeVideos = async (autoMerge: boolean = false) => {
        if (generatedVideos.length === 0) {
            setError('No videos to merge. Please generate videos first.');
            return;
        }

        setIsMergingVideos(true);
        setMergeProgress('Preparing to merge videos...');

        try {
            // Load FFmpeg if not loaded
            await loadFFmpeg();

            const ffmpeg = ffmpegRef.current;
            setMergeProgress('Downloading videos from ComfyUI...');

            // Download all videos
            const videoBlobs: Blob[] = [];
            for (let i = 0; i < generatedVideos.length; i++) {
                setMergeProgress(`Downloading video ${i + 1}/${generatedVideos.length}...`);
                const blob = await downloadVideoFromURL(generatedVideos[i]);
                videoBlobs.push(blob);
            }

            // Write videos to FFmpeg filesystem
            setMergeProgress('Writing videos to FFmpeg...');
            for (let i = 0; i < videoBlobs.length; i++) {
                const videoData = await fetchFile(videoBlobs[i]);
                await ffmpeg.writeFile(`video${i}.mp4`, videoData);
            }

            // Create concat file
            const concatContent = videoBlobs.map((_, i) => `file 'video${i}.mp4'`).join('\n');
            await ffmpeg.writeFile('concat.txt', concatContent);

            // Merge videos
            setMergeProgress('Merging videos...');
            await ffmpeg.exec(['-f', 'concat', '-safe', '0', '-i', 'concat.txt', '-c', 'copy', 'output.mp4']);

            // Read the result
            setMergeProgress('Reading merged video...');
            const data = await ffmpeg.readFile('output.mp4');
            const mergedBlob = new Blob([data], { type: 'video/mp4' });

            // Create object URL for preview
            const url = URL.createObjectURL(mergedBlob);
            setMergedVideoUrl(url);

            setMergeProgress('Video merged successfully!');
            if (autoMerge) {
                showNotification('Videos automatically merged! Scroll down to preview.', 'success');
            } else {
                showNotification('Video merged successfully! Preview below.', 'success');
            }

            // Clean up FFmpeg files
            for (let i = 0; i < videoBlobs.length; i++) {
                await ffmpeg.deleteFile(`video${i}.mp4`);
            }
            await ffmpeg.deleteFile('concat.txt');
            await ffmpeg.deleteFile('output.mp4');

        } catch (e: any) {
            console.error('Video merge error:', e);
            setError(`Failed to merge videos: ${e.message}`);
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
        showNotification('Video downloaded successfully!', 'success');
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
        setShowSettings(false);
        showNotification('設定已儲存！', 'success');
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

        // If endImage is provided, configure workflow for dual-image mode
        if (endImage) {
            // Dual-image mode: upload both images
            const startImageName = await uploadImageToComfyUI(startImage, `start_${Date.now()}.png`);
            const endImageName = await uploadImageToComfyUI(endImage, `end_${Date.now()}.png`);
            workflow[startFrameNode].inputs.image = startImageName;
            workflow[endFrameNode].inputs.image = endImageName;
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

            showNotification(successMessage, 'success');

            // Automatically merge videos after generation
            setTimeout(() => {
                mergeVideos(true);
            }, 1000);

        } catch (e: any) {
            console.error('Video generation error:', e);
            setError(`Video generation failed: ${e.message}`);
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
        const updatedStoryboard = [...storyboard];
        updatedStoryboard[index].image_prompt = newPrompt;
        setStoryboard(updatedStoryboard);
    };

    const handleRemoveCut = (index: number) => {
        if (storyboard.length <= 1) {
            setError('Cannot remove the last cut. At least one cut is required.');
            return;
        }

        showConfirm(`Are you sure you want to remove Cut #${storyboard[index].cut}?`, () => {
            const updatedStoryboard = storyboard.filter((_, i) => i !== index);

            // Renumber the remaining cuts
            const renumberedStoryboard = updatedStoryboard.map((cut, i) => ({
                ...cut,
                cut: i + 1
            }));

            setStoryboard(renumberedStoryboard);
            setNumCuts(renumberedStoryboard.length);
            setConfirmDialog(null);
        });
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
        } catch (err: any) {
            console.error("Failed to save project:", err);
            setError(`儲存專案失敗: ${err.message}`);
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

    const handleDownload = async () => {
        if (storyboard.length === 0) return;
        const zip = new JSZip();
        
        const jsonContent = JSON.stringify(storyboard.map(cut => ({
            cut: cut.cut,
            image_prompt: cut.image_prompt,
            video_prompt: cut.video_prompt
        })), null, 2);

        zip.file("storyboard.json", jsonContent);

        for (const cut of storyboard) {
            if (cut.generated_image) {
                const blob = await base64ToBlob(cut.generated_image);
                zip.file(`cut_${cut.cut}.png`, blob);
            }
        }
        
        zip.generateAsync({ type: "blob" }).then(function(content: any) {
            const link = document.createElement('a');
            link.href = URL.createObjectURL(content);
            link.download = "storyboard_project.zip";
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
        });
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
                    <button className="btn btn-secondary" onClick={handleSaveProject} disabled={!initialImage}>儲存專案</button>
                    <input type="file" id="load-project-input" accept=".zip" onChange={handleLoadProject} style={{ display: 'none' }} />
                    <label htmlFor="load-project-input" className="btn btn-secondary">載入專案</label>
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
                        <button className="btn btn-primary" onClick={handleDownload}>下載專案 (.zip)</button>
                        <button
                            className="btn btn-success"
                            onClick={handleGenerateVideos}
                            disabled={isGeneratingVideo || storyboard.some(cut => !cut.generated_image)}
                            title={storyboard.some(cut => !cut.generated_image) ? 'Please generate all images first' : 'Generate Videos'}
                        >
                            {isGeneratingVideo ? 'Generating Videos...' : 'Generate Videos'}
                        </button>
                        {generatedVideos.length > 0 && (
                            <>
                                <button
                                    className="btn btn-preview"
                                    onClick={() => {
                                        setCurrentPreviewIndex(0);
                                        setShowVideoPreview(true);
                                    }}
                                    disabled={isMergingVideos}
                                >
                                    Preview Videos
                                </button>
                                <button
                                    className="btn btn-merge"
                                    onClick={() => mergeVideos(false)}
                                    disabled={isMergingVideos}
                                >
                                    {isMergingVideos ? 'Merging...' : 'Re-merge Videos'}
                                </button>
                            </>
                        )}
                    </div>
                    {isGeneratingVideo && (
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
                                <h2>Final Merged Video</h2>
                                <button className="btn btn-primary" onClick={downloadMergedVideo}>
                                    Download Video
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
                            <div key={index} className={`cut-card`}>
                                <div className="cut-header">
                                    <h3>Cut #{cut.cut}</h3>
                                    <button
                                        className="btn btn-delete"
                                        onClick={() => handleRemoveCut(index)}
                                        title="Remove this cut"
                                        disabled={storyboard.length <= 1}
                                    >
                                        ✕
                                    </button>
                                </div>
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
                                    <label>影片提示詞</label>
                                    <div className="prompt-text-container">
                                        <div className="prompt-text">{cut.video_prompt}</div>
                                        <button className={`btn btn-copy ${copiedStates[index] ? 'copied' : ''}`} onClick={() => handleCopy(cut.video_prompt, index)}>
                                            {copiedStates[index] ? '✓' : '複製'}
                                        </button>
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {/* Video Preview Modal */}
            {showVideoPreview && generatedVideos.length > 0 && (
                <div className="modal-overlay" onClick={() => setShowVideoPreview(false)}>
                    <div className="modal-content video-preview-modal" onClick={(e) => e.stopPropagation()}>
                        <div className="video-preview-header">
                            <h2>Video Preview ({currentPreviewIndex + 1} / {generatedVideos.length})</h2>
                            <button className="btn btn-close" onClick={() => setShowVideoPreview(false)}>✕</button>
                        </div>
                        <div className="video-preview-container">
                            <video
                                key={generatedVideos[currentPreviewIndex]}
                                controls
                                autoPlay
                                loop
                                className="preview-video"
                            >
                                <source src={generatedVideos[currentPreviewIndex]} type="video/mp4" />
                                Your browser does not support the video tag.
                            </video>
                        </div>
                        <div className="video-preview-controls">
                            <button
                                className="btn btn-secondary"
                                onClick={() => setCurrentPreviewIndex(Math.max(0, currentPreviewIndex - 1))}
                                disabled={currentPreviewIndex === 0}
                            >
                                ← Previous
                            </button>
                            <span className="video-preview-info">
                                Cut {currentPreviewIndex + 1} → Cut {currentPreviewIndex + 2}
                            </span>
                            <button
                                className="btn btn-secondary"
                                onClick={() => setCurrentPreviewIndex(Math.min(generatedVideos.length - 1, currentPreviewIndex + 1))}
                                disabled={currentPreviewIndex === generatedVideos.length - 1}
                            >
                                Next →
                            </button>
                        </div>
                        <div className="video-preview-actions">
                            <a
                                href={generatedVideos[currentPreviewIndex]}
                                download={`video_${currentPreviewIndex + 1}.mp4`}
                                className="btn btn-primary"
                            >
                                Download This Video
                            </a>
                            <button
                                className="btn btn-merge"
                                onClick={() => {
                                    setShowVideoPreview(false);
                                    mergeVideos();
                                }}
                            >
                                Merge All & Download
                            </button>
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
        </div>
    );
};

const root = ReactDOM.createRoot(document.getElementById('root')!);
root.render(<App />);