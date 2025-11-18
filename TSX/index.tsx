
import React, { useState, useRef, useCallback, useEffect } from 'react';
import ReactDOM from 'react-dom/client';
import { GoogleGenAI, Type, Modality } from "@google/genai";

declare var JSZip: any;

const App = () => {
    const API_CALL_BATCH_SIZE = 9;
    const API_CALL_DELAY_MS = 60000; // 1 minute

    const [initialImages, setInitialImages] = useState<{ id: number, file: File, dataUrl: string, tag: string }[]>([]);
    const [processedImages, setProcessedImages] = useState<{ id: number, dataUrl: string, tag: string }[]>([]);

    const [aspectRatio, setAspectRatio] = useState('16:9');
    const [isImageToVideoMode, setIsImageToVideoMode] = useState(false);
    const [outline, setOutline] = useState('');
    const [numCuts, setNumCuts] = useState<number>(3);
    const [generationMode, setGenerationMode] = useState('character_closeup'); // 'character_closeup', 'character_in_scene', 'object_closeup', 'storytelling_scene', 'animation', 'freestyle'
    const [prioritizeFaceShots, setPrioritizeFaceShots] = useState(false);

    const [isLoading, setIsLoading] = useState(false);
    const [loadingMessage, setLoadingMessage] = useState('');
    const [error, setError] = useState('');

    const [storyboard, setStoryboard] = useState<any[]>([]);
    const [copiedStates, setCopiedStates] = useState<{ [key: number]: boolean }>({});
    
    const [regeneratingIndex, setRegeneratingIndex] = useState<number | null>(null);
    const [upscalingIndex, setUpscalingIndex] = useState<number | null>(null);
    const [regeneratingVideoPromptIndex, setRegeneratingVideoPromptIndex] = useState<number | null>(null);
    const [optimizingVideoPromptIndex, setOptimizingVideoPromptIndex] = useState<number | null>(null);
    const [reviewingVideoPromptIndex, setReviewingVideoPromptIndex] = useState<number | null>(null);
    const [editingTarget, setEditingTarget] = useState<{type: 'image' | 'video', index: number} | null>(null);
    const [isProjectLoaded, setIsProjectLoaded] = useState(false);


    const uploadAreaRef = useRef<HTMLDivElement>(null);
    const ai = new GoogleGenAI({ apiKey: process.env.API_KEY! });

    const outlinePlaceholders: { [key: string]: string } = {
        character_closeup: '請描述角色的特寫鏡頭，專注於表情、情緒或與特定物件的互動。例如：「角色1 微笑著，陽光灑在她臉上，手中拿著 產品A。」',
        character_in_scene: '請描述角色與環境的互動。例如：「角色1 敏捷地在充滿未來感的都市叢林中攀爬穿梭。」',
        object_closeup: '請專注描述物件或產品的細節與質感。例如：「特寫展示 手錶 的精緻錶盤，光線流淌過金屬表面。」',
        storytelling_scene: '請描述一個包含人、物、景的完整情境故事。例如：「在溫馨的咖啡館裡，角色1 專注地使用 筆記型電腦，窗外下著雨。」',
        animation: '請使用您在下方設定的角色/物件名稱來描述故事。例如：「魔法少女 在星空下的城市中與 神秘敵人 戰鬥。」',
        freestyle: '自由發揮您的創意，AI 將給予最大程度的創作詮釋。',
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
                // For better quality, we can render the canvas at a higher resolution if needed
                const outputWidth = Math.min(sWidth, 1024); // Cap output width for performance
                const outputHeight = outputWidth / targetRatio;
                canvas.width = outputWidth;
                canvas.height = outputHeight;

                const ctx = canvas.getContext('2d');

                if (!ctx) {
                    return reject(new Error('無法獲取 Canvas Context'));
                }
                
                ctx.drawImage(img, sx, sy, sWidth, sHeight, 0, 0, canvas.width, canvas.height);
                
                resolve(canvas.toDataURL('image/png'));
            };
            img.onerror = () => reject(new Error("無法載入圖片以進行裁切。"));
            img.src = dataUrl;
        });
    };

    useEffect(() => {
        if (initialImages.length === 0) {
            setProcessedImages([]);
            return;
        }

        const performCropAll = async () => {
            try {
                setError('');
                const cropPromises = initialImages.map(img => 
                    cropImageToAspectRatio(img.dataUrl, aspectRatio).then(croppedUrl => ({
                        id: img.id,
                        dataUrl: croppedUrl,
                        tag: img.tag
                    }))
                );
                const newProcessedImages = await Promise.all(cropPromises);
                setProcessedImages(newProcessedImages);
            } catch (e: any) {
                console.error("Cropping failed:", e);
                setError(`圖片裁切失敗: ${e.message}`);
                setProcessedImages(initialImages.map(img => ({ id: img.id, dataUrl: img.dataUrl, tag: img.tag })));
            }
        };

        performCropAll();
    }, [initialImages, aspectRatio]);


    const handleImagePromptChange = (index: number, newPrompt: string) => {
        const updatedStoryboard = [...storyboard];
        updatedStoryboard[index].image_prompt = newPrompt;
        setStoryboard(updatedStoryboard);
    };

    const handleVideoPromptChange = (index: number, newPrompt: string) => {
        const updatedStoryboard = [...storyboard];
        updatedStoryboard[index].video_prompt = newPrompt;
        setStoryboard(updatedStoryboard);
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

    const base64ToBlob = async (base64: string, type = 'image/png') => {
        const res = await fetch(base64);
        return await res.blob();
    };

    const invalidateAdjacentVideoPrompts = (indexToInvalidate: number, currentStoryboard: any[]) => {
        const board = [...currentStoryboard];
        const invalidationMessage = '相鄰圖片已變更，提示詞已失效。';

        // Invalidate the prompt for the transition STARTING FROM the changed image
        board[indexToInvalidate].video_prompt = invalidationMessage;

        // Invalidate the prompt for the transition ENDING AT the changed image
        // This means finding the first visible shot BEFORE this one.
        let prevVisibleIndex = -1;
        for (let i = indexToInvalidate - 1; i >= 0; i--) {
            if (!board[i].isDeleted) {
                prevVisibleIndex = i;
                break;
            }
        }
        if (prevVisibleIndex !== -1) {
            board[prevVisibleIndex].video_prompt = invalidationMessage;
        }
        return board;
    };

    const handleSaveProject = async () => {
        if (initialImages.length === 0) {
            setError('沒有可儲存的專案。請先上傳參考圖。');
            return;
        }
    
        try {
            const zip = new JSZip();
    
            // Generate standardized filenames for saving to prevent collisions
            const initialImagesForSave = initialImages.map((img, index) => {
                const standardizedFilename = index === 0 ? 'initial_image.png' : `initial_image_${index}.png`;
                return {
                    tag: img.tag,
                    filename: standardizedFilename, // Use standardized name
                    originalDataUrl: img.dataUrl   // Keep original data to create blob
                };
            });
    
            const projectData = {
                aspectRatio,
                isImageToVideoMode,
                prioritizeFaceShots,
                outline,
                numCuts,
                // Store metadata with standardized filenames
                initialImages: initialImagesForSave.map(({ tag, filename }) => ({ tag, filename })),
                storyboard: storyboard.map(cut => ({
                    cut: cut.cut,
                    image_prompt: cut.image_prompt,
                    video_prompt: cut.video_prompt,
                    isDeleted: cut.isDeleted || false,
                }))
            };
            zip.file("project.json", JSON.stringify(projectData, null, 2));
    
            // Save initial images with their new standardized filenames
            for (const imgData of initialImagesForSave) {
                const blob = await base64ToBlob(imgData.originalDataUrl);
                zip.file(imgData.filename, blob);
            }
    
            // Save generated storyboard images
            for (const cut of storyboard) {
                if (cut.generated_image) {
                    const blob = await base64ToBlob(cut.generated_image);
                    zip.file(`cut_${cut.cut}.png`, blob);
                }
            }
    
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
            setStoryboard([]); 

            const zip = new JSZip();
            const zipData = await zip.loadAsync(file);

            const projectJsonFile = zipData.file("project.json");
            if (!projectJsonFile) throw new Error('專案檔案中找不到 project.json');
            const projectJsonText = await projectJsonFile.async("text");
            const projectData = JSON.parse(projectJsonText);

            if (!projectData.aspectRatio || !projectData.outline) throw new Error('專案檔案格式不符或已損毀');

            const loadedInitialImages: { id: number, file: File, dataUrl: string, tag: string }[] = [];
            if (projectData.initialImages && projectData.initialImages.length > 0) {
                for (let i = 0; i < projectData.initialImages.length; i++) {
                    const imgData = projectData.initialImages[i];
                    const initialImageFile = zipData.file(imgData.filename);
                    if (!initialImageFile) throw new Error(`專案檔案中找不到圖片: ${imgData.filename}`);
                    
                    const initialImageBlob = await initialImageFile.async("blob");
                    const initialImageDataUrl = await new Promise<string>((resolve) => {
                        const reader = new FileReader();
                        reader.onload = (e) => resolve(e.target?.result as string);
                        reader.readAsDataURL(initialImageBlob);
                    });

                    const loadedFile = dataURLtoFile(initialImageDataUrl, imgData.filename);
                    loadedInitialImages.push({
                        id: Date.now() + i,
                        file: loadedFile,
                        dataUrl: initialImageDataUrl,
                        tag: imgData.tag
                    });
                }
            } else { // Backwards compatibility for single-image projects
                const initialImageFile = zipData.file("initial_image.png");
                if (!initialImageFile) throw new Error('專案檔案中找不到初始圖片');
                const initialImageBlob = await initialImageFile.async("blob");
                const initialImageDataUrl = await new Promise<string>((resolve) => {
                    const reader = new FileReader();
                    reader.onload = (e) => resolve(e.target?.result as string);
                    reader.readAsDataURL(initialImageBlob);
                });
                const loadedFile = dataURLtoFile(initialImageDataUrl, 'initial_image.png');
                loadedInitialImages.push({
                    id: Date.now(),
                    file: loadedFile,
                    dataUrl: initialImageDataUrl,
                    tag: '角色 1'
                });
            }

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
                    generated_image: generatedImage,
                    isDeleted: cutData.isDeleted || false,
                });
            }

            setAspectRatio(projectData.aspectRatio);
            setIsImageToVideoMode(projectData.isImageToVideoMode || false);
            setPrioritizeFaceShots(projectData.prioritizeFaceShots || false);
            setOutline(projectData.outline);
            setNumCuts(projectData.numCuts || 1);
            setStoryboard(loadedStoryboard);
            setInitialImages(loadedInitialImages);
            setIsProjectLoaded(true); 

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

    const generateFinalImagePrompt = (
        actionPrompt: string,
        mode: string,
        targetAspectRatio: string,
        isImageToVideo: boolean,
        referenceImages: { tag: string }[]
    ): string => {
        let characterReferenceInstruction = '';
        if (referenceImages.length > 0) {
            const referenceList = referenceImages.map((ref, index) => `- **${ref.tag}:** 這是指第 ${index + 1} 張輸入的參考圖片。`).join('\n');
            characterReferenceInstruction = `**角色/物件參考:**\n你收到了 ${referenceImages.length} 張參考圖片。請根據以下對應關係來理解它們：\n${referenceList}\n**一致性規則:** 請嚴格參照「角色/物件參考」。在生成圖片時，若場景描述中提到某個角色/物件的名稱（例如 ${referenceImages[0]?.tag || '角色1'}），你必須嚴格保持其在對應參考圖中的關鍵特徵（如臉部、服裝、外觀）不變。`;
        }
    
        let taskDescription = '根據提供的參考圖與描述，生成一張新的高品質圖片。';
        let styleInstruction = '**風格:** 必須是「寫實照片風格 (Raw photo)」，強調自然光影、電影感與豐富細節。';
        let negativePrompt = '**禁止事項 (Negative Prompt):** 絕對禁止任何動漫 (anime)、卡通 (cartoon)、插畫 (illustration) 或非寫實風格。';
        let physicsInstruction = '**物理性:** 所有物理互動、人體結構都必須真實且符合邏輯。';
    
        if (mode === 'animation') {
            styleInstruction = '**風格:** 必須是「高品質動畫風格 (High-quality anime style)」，具有清晰的線條、鮮豔的色彩和富有表現力的構圖。';
            negativePrompt = '**禁止事項 (Negative Prompt):** 絕對禁止任何寫實 (realistic)、照片 (photo)、3D渲染 (3D render) 或真人風格。';
            physicsInstruction = '**物理性:** 所有物理互動、人體結構都必須符合動畫的邏輯與誇飾。';
        }
    
        let compositionInstruction = '';
        switch (mode) {
            case 'character_closeup':
                compositionInstruction = '**構圖與焦點:** 嚴格執行「特寫 (Close-up)」或「中景特寫 (Medium Close-up)」。畫面焦點必須集中在角色的臉部，捕捉其細微的表情和眼神。背景可以是虛化的散景 (bokeh)，以凸顯主體。';
                break;
            case 'character_in_scene':
                compositionInstruction = '**構圖與焦點:** 使用「中景 (Medium Shot)」或「遠景 (Long Shot)」來展示角色與周遭環境的完整互動。強調場景的氛圍、光影和深度感，讓角色自然地融入其中。';
                break;
            case 'object_closeup':
                compositionInstruction = `**構圖與焦點:** 採用「產品攝影 (Product Shot)」或「微距攝影 (Macro Shot)」的風格。焦點必須集中在「${actionPrompt}」中描述的核心物件上，極致地展現其材質、紋理和細節。使用專業打光來突顯物件的質感。`;
                break;
            case 'storytelling_scene':
                compositionInstruction = '**構圖與焦點:** 運用「電影場景構圖 (Cinematic Scene Composition)」。畫面需包含角色、關鍵物件和背景環境，共同營造一個有故事感的瞬間。注意元素間的位置關係與互動，引導觀眾的視線。';
                break;
            case 'freestyle':
                compositionInstruction = '**構圖與焦點:** 你擁有完全的創作自由，請根據場景描述選擇最佳的構圖與攝影風格，創造出最具視覺衝擊力的畫面。';
                break;
        }
    
        return `
**任務:** ${taskDescription}
${characterReferenceInstruction}
**場景描述:** ${actionPrompt}
**全局指令:**
- **圖片格式:** 嚴格遵守 ${targetAspectRatio} 的長寬比。
- ${styleInstruction}
- ${compositionInstruction}
- ${negativePrompt}
- ${physicsInstruction}
**輸出格式:** 你的唯一輸出必須是一張圖片。絕對禁止生成任何文字回應、解釋或評論。直接輸出圖片。`;
    };

    const handleRegenerateImages = async () => {
        if (initialImages.length === 0) {
            setError('必須先有參考圖才能重新生成圖片。');
            return;
        }
        if (storyboard.length === 0) {
            setError('必須先有分鏡腳本才能重新生成圖片。');
            return;
        }

        setIsLoading(true);
        setError('');
        try {
            const tempStoryboard = [...storyboard];

            for (let i = 0; i < tempStoryboard.length; i++) {
                if (tempStoryboard[i].isDeleted) continue; 

                setLoadingMessage(`正在重新生成第 ${i + 1} / ${tempStoryboard.length} 張分鏡圖...`);
                tempStoryboard[i].generated_image = '';
                setStoryboard([...tempStoryboard]);

                let finalImageUrl = '';

                try {
                    let finalImagePrompt = generateFinalImagePrompt(tempStoryboard[i].image_prompt, generationMode, aspectRatio, isImageToVideoMode, processedImages);
                    let fullDataUrl = '';
                    let attempt = 1;

                    while (attempt <= 2) { 
                        try {
                            const imageParts = processedImages.map(img => ({
                                inlineData: {
                                    data: img.dataUrl.split(',')[1],
                                    mimeType: 'image/png',
                                }
                            }));
                            const parts: any[] = [...imageParts, { text: finalImagePrompt }];

                            const imageResponse = await ai.models.generateContent({
                                model: 'gemini-2.5-flash-image',
                                contents: { parts: parts },
                                config: { responseModalities: [Modality.IMAGE] },
                            });
                            
                            let generatedImageBase64 = '';
                            const responseParts = imageResponse?.candidates?.[0]?.content?.parts;
                            if (responseParts) {
                                for (const part of responseParts) {
                                    if (part.inlineData) {
                                        generatedImageBase64 = part.inlineData.data;
                                        break;
                                    }
                                }
                            }
                            
                            if (!generatedImageBase64) {
                                const feedback = imageResponse?.promptFeedback;
                                const blockReason = feedback?.blockReason;
                                if (blockReason === 'SAFETY' && attempt === 1) {
                                    console.warn(`鏡頭 ${i + 1} 因安全原因被阻擋。嘗試修正提示詞後重試...`);
                                    const sanitizationRequest = `以下圖片提示詞因安全原因被阻擋。請在保留原意的基礎上，將其改寫得更安全、更符合內容政策。原始提示詞： "${tempStoryboard[i].image_prompt}"`;
                                    const sanitizedResponse = await ai.models.generateContent({ model: 'gemini-2.5-flash', contents: sanitizationRequest });
                                    
                                    if (!sanitizedResponse.text) throw new Error('無法自動修正提示詞。');
                                    
                                    const sanitizedImagePrompt = sanitizedResponse.text.trim();
                                    tempStoryboard[i].image_prompt = sanitizedImagePrompt;
                                    finalImagePrompt = generateFinalImagePrompt(sanitizedImagePrompt, generationMode, aspectRatio, isImageToVideoMode, processedImages);
                                    
                                    attempt++;
                                    continue;
                                }
                                throw new Error(`API返回空圖片。原因: ${blockReason || '未知'}`);
                            }

                            fullDataUrl = `data:image/png;base64,${generatedImageBase64}`;
                            break; 

                        } catch (e: any) {
                            if ((e.message.includes('429') || e.message.toLowerCase().includes('quota')) && attempt === 1) {
                                setLoadingMessage(`API用量限制。等待1分鐘後重試 (鏡頭 ${i + 1})...`);
                                await new Promise(resolve => setTimeout(resolve, 60000));
                                attempt++;
                                continue;
                            }
                            throw e;
                        }
                    }
                    
                    if (fullDataUrl) {
                        finalImageUrl = await cropImageToAspectRatio(fullDataUrl, aspectRatio);
                    }

                } catch (e: any) {
                    console.warn(`鏡頭 ${i + 1} 未能生成圖片，即使在重試後。錯誤: ${e.message}`);
                    finalImageUrl = ''; 
                }

                tempStoryboard[i].generated_image = finalImageUrl;
                setStoryboard([...tempStoryboard]);

                if ((i + 1) % API_CALL_BATCH_SIZE === 0 && (i + 1) < tempStoryboard.length) {
                    setLoadingMessage(`已重新生成 ${i + 1} 張圖片，為避免觸發API速率限制，將等待 1 分鐘...`);
                    await new Promise(resolve => setTimeout(resolve, API_CALL_DELAY_MS));
                }
            }
        } catch (e: any) {
            console.error(e);
            setError(`圖片生成失敗: ${e.message}`);
        } finally {
            setIsLoading(false);
            setLoadingMessage('');
        }
    };
    
    const handleRegenerateSingleImage = async (index: number) => {
        if (initialImages.length === 0) {
            setError('無法重新生成，缺少參考圖。');
            return;
        }
        if (!storyboard[index]) {
            setError('無法重新生成，缺少必要資訊。');
            return;
        }
    
        setRegeneratingIndex(index);
        setError('');
    
        try {
            let tempStoryboard = [...storyboard];
            const promptData = tempStoryboard[index];
    
            let finalImagePrompt = generateFinalImagePrompt(promptData.image_prompt, generationMode, aspectRatio, isImageToVideoMode, processedImages);
            let fullDataUrl = '';
            let attempt = 1;
    
            while (attempt <= 2) { 
                try {
                    const imageParts = processedImages.map(img => ({
                        inlineData: {
                            data: img.dataUrl.split(',')[1],
                            mimeType: 'image/png',
                        }
                    }));
                    const parts: any[] = [...imageParts, { text: finalImagePrompt }];

                    const imageResponse = await ai.models.generateContent({
                        model: 'gemini-2.5-flash-image',
                        contents: { parts: parts },
                        config: { responseModalities: [Modality.IMAGE] },
                    });
    
                    let generatedImageBase64 = '';
                    const responseParts = imageResponse?.candidates?.[0]?.content?.parts;
                    if (responseParts) {
                        for (const part of responseParts) {
                            if (part.inlineData) {
                                generatedImageBase64 = part.inlineData.data;
                                break;
                            }
                        }
                    }
    
                    if (!generatedImageBase64) {
                        const feedback = imageResponse?.promptFeedback;
                        const blockReason = feedback?.blockReason;
                        if (blockReason === 'SAFETY' && attempt === 1) {
                            console.warn(`鏡頭 #${index + 1} 因安全原因被阻擋。嘗試修正提示詞後重試...`);
                            
                            const sanitizationRequest = `以下圖片提示詞因安全原因被阻擋。請在保留原始藝術意圖的基礎上，將其改寫得更安全、更符合內容政策。請專注於移除潛在的敏感、暴力或露骨語言。原始提示詞： "${promptData.image_prompt}"`;
                            const sanitizedResponse = await ai.models.generateContent({ model: 'gemini-2.5-flash', contents: sanitizationRequest });
                            
                            if (!sanitizedResponse.text) {
                                throw new Error('無法自動修正提示詞。');
                            }
                            
                            const sanitizedImagePrompt = sanitizedResponse.text.trim();
                            tempStoryboard[index].image_prompt = sanitizedImagePrompt;
                            finalImagePrompt = generateFinalImagePrompt(sanitizedImagePrompt, generationMode, aspectRatio, isImageToVideoMode, processedImages);
                            
                            attempt++;
                            continue;
                        }
                        throw new Error(`未能生成圖片。原因: ${blockReason || 'API返回空圖片'}`);
                    }
                    
                    fullDataUrl = `data:image/png;base64,${generatedImageBase64}`;
                    break; 
                    
                } catch (e: any) {
                    if ((e.message.includes('429') || e.message.toLowerCase().includes('quota')) && attempt === 1) {
                        console.warn(`API用量限制。等待1分鐘後重試...`);
                        await new Promise(resolve => setTimeout(resolve, 60000));
                        attempt++;
                        continue;
                    }
                    throw e;
                }
            }
    
            if (!fullDataUrl) {
                throw new Error('即使在重試後，圖片生成仍然失敗。');
            }
    
            tempStoryboard[index].generated_image = await cropImageToAspectRatio(fullDataUrl, aspectRatio);
            tempStoryboard = invalidateAdjacentVideoPrompts(index, tempStoryboard);
            setStoryboard(tempStoryboard);
    
        } catch (e: any) {
            console.error(e);
            setError(`鏡頭 #${index + 1} 圖片重新生成失敗: ${e.message}`);
        } finally {
            setRegeneratingIndex(null);
        }
    };
    
    const handleUpscaleSingleImage = async (index: number) => {
        const cut = storyboard[index];
        if (!cut || !cut.generated_image) {
            setError('無法升頻，缺少原始圖片。');
            return;
        }

        setUpscalingIndex(index);
        setError('');

        try {
            let tempStoryboard = [...storyboard];
            const referenceImage = cut.generated_image;
            
            const upscalePrompt = `**任務:** 提升這張圖片的解析度並增強細節。
**核心規則:**
1. **嚴格一致性:** 絕對保持原始構圖、角色特徵、物體和色彩不變。
2. **禁止變更:** 不可添加、刪除或修改任何原始圖片中的元素。
3. **目標:** 創造一個更清晰、更細膩的高解析度版本。
**輸出格式:** 你的唯一輸出必須是升頻後的圖片。絕對禁止生成任何文字回應、解釋或評論。`;
            
            const referenceImagePart = {
                inlineData: {
                    data: referenceImage.split(',')[1],
                    mimeType: 'image/png',
                }
            };

            const imageResponse = await ai.models.generateContent({
                model: 'gemini-2.5-flash-image',
                contents: { parts: [referenceImagePart, { text: upscalePrompt }] },
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
                 throw new Error(`升頻失敗。原因: ${blockReason || 'API返回空圖片'}`);
            }

            const fullDataUrl = `data:image/png;base64,${generatedImageBase64}`;
            tempStoryboard[index].generated_image = fullDataUrl; // No need to crop
            tempStoryboard = invalidateAdjacentVideoPrompts(index, tempStoryboard);
            setStoryboard(tempStoryboard);

        } catch (e: any) {
            console.error(e);
            setError(`鏡頭 #${index + 1} 圖片升頻失敗: ${e.message}`);
        } finally {
            setUpscalingIndex(null);
        }
    };
    
    const handleUpscaleAllImages = async () => {
        const imagesToUpscale = storyboard.filter(cut => !cut.isDeleted && cut.generated_image);
        if (imagesToUpscale.length === 0) {
            setError('沒有可升頻的圖片。');
            return;
        }

        setIsLoading(true);
        setError('');
        const tempStoryboard = [...storyboard];

        try {
            for (let i = 0; i < tempStoryboard.length; i++) {
                const cut = tempStoryboard[i];
                if (cut.isDeleted || !cut.generated_image) continue;

                setLoadingMessage(`正在升頻第 ${i + 1} / ${tempStoryboard.length} 張圖片...`);
                
                try {
                    const referenceImage = cut.generated_image;
                    const upscalePrompt = `**任務:** 提升這張圖片的解析度並增強細節。
**核心規則:**
1. **嚴格一致性:** 絕對保持原始構圖、角色特徵、物體和色彩不變。
2. **禁止變更:** 不可添加、刪除或修改任何原始圖片中的元素。
3. **目標:** 創造一個更清晰、更細膩的高解析度版本。
**輸出格式:** 你的唯一輸出必須是升頻後的圖片。絕對禁止生成任何文字回應、解釋或評論。`;
                    const referenceImagePart = { inlineData: { data: referenceImage.split(',')[1], mimeType: 'image/png' } };

                    const imageResponse = await ai.models.generateContent({
                        model: 'gemini-2.5-flash-image',
                        contents: { parts: [referenceImagePart, { text: upscalePrompt }] },
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

                    if (!generatedImageBase64) throw new Error('API返回空圖片');
                    
                    cut.generated_image = `data:image/png;base64,${generatedImageBase64}`;
                    setStoryboard([...tempStoryboard]);
                
                } catch (e: any) {
                    console.error(`升頻圖片 #${i + 1} 失敗:`, e);
                    // Continue to the next image on failure
                }

                 if ((i + 1) % API_CALL_BATCH_SIZE === 0 && (i + 1) < tempStoryboard.length) {
                    setLoadingMessage(`已升頻 ${i + 1} 張圖片，為避免觸發API速率限制，將等待 1 分鐘...`);
                    await new Promise(resolve => setTimeout(resolve, API_CALL_DELAY_MS));
                }
            }
        } catch(e: any) {
             setError(`批量升頻失敗: ${e.message}`);
        } finally {
            setIsLoading(false);
            setLoadingMessage('');
        }
    };


    const handleExtendAndCorrectImage = async (index: number) => {
        const previousCut = storyboard[index - 1];
        if (!previousCut?.generated_image || !storyboard[index]) {
            setError('無法延伸修正，缺少前一鏡頭的圖片或當前鏡頭的資訊。');
            return;
        }

        setRegeneratingIndex(index);
        setError('');

        try {
            let tempStoryboard = [...storyboard];
            const promptData = tempStoryboard[index];
            const sceneReferenceImage = previousCut.generated_image; 

            let finalImagePrompt = generateFinalImagePrompt(promptData.image_prompt, generationMode, aspectRatio, false, processedImages);
            let fullDataUrl = '';
            let attempt = 1;

            while (attempt <= 2) {
                try {
                    const sceneReferenceImagePart = {
                        inlineData: { data: sceneReferenceImage.split(',')[1], mimeType: 'image/png' }
                    };
                    const characterImageParts = processedImages.map(img => ({
                        inlineData: { data: img.dataUrl.split(',')[1], mimeType: 'image/png' }
                    }));

                    const imageResponse = await ai.models.generateContent({
                        model: 'gemini-2.5-flash-image',
                        contents: { parts: [sceneReferenceImagePart, ...characterImageParts, { text: finalImagePrompt }] },
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
                        if (blockReason === 'SAFETY' && attempt === 1) {
                            console.warn(`延伸修正 #${index + 1} 因安全原因被阻擋。嘗試修正提示詞後重試...`);
                            const sanitizationRequest = `以下圖片提示詞因安全原因被阻擋。請在保留原意的基礎上，將其改寫得更安全、更符合內容政策。原始提示詞： "${promptData.image_prompt}"`;
                            const sanitizedResponse = await ai.models.generateContent({ model: 'gemini-2.5-flash', contents: sanitizationRequest });
                            
                            if (!sanitizedResponse.text) throw new Error('無法自動修正提示詞。');
                            
                            const sanitizedImagePrompt = sanitizedResponse.text.trim();
                            tempStoryboard[index].image_prompt = sanitizedImagePrompt;
                            finalImagePrompt = generateFinalImagePrompt(sanitizedImagePrompt, generationMode, aspectRatio, false, processedImages);
                            
                            attempt++;
                            continue;
                        }
                        throw new Error(`未能生成圖片。原因: ${blockReason || 'API返回空圖片'}`);
                    }
                    
                    fullDataUrl = `data:image/png;base64,${generatedImageBase64}`;
                    break;
                    
                } catch (e: any) {
                    if ((e.message.includes('429') || e.message.toLowerCase().includes('quota')) && attempt === 1) {
                        console.warn(`API用量限制。等待1分鐘後重試...`);
                        await new Promise(resolve => setTimeout(resolve, 60000));
                        attempt++;
                        continue;
                    }
                    throw e;
                }
            }

            if (!fullDataUrl) {
                throw new Error('即使在重試後，圖片生成仍然失敗。');
            }

            tempStoryboard[index].generated_image = await cropImageToAspectRatio(fullDataUrl, aspectRatio);
            tempStoryboard = invalidateAdjacentVideoPrompts(index, tempStoryboard);
            setStoryboard(tempStoryboard);

        } catch (e: any) {
            console.error(e);
            setError(`鏡頭 #${index + 1} 延伸修正失敗: ${e.message}`);
        } finally {
            setRegeneratingIndex(null);
        }
    };


    const handleReplaceImage = async (index: number, file: File) => {
        if (!file) return;
    
        setRegeneratingIndex(index); 
        setError('');
        
        try {
            const dataUrl = await new Promise<string>((resolve, reject) => {
                const reader = new FileReader();
                reader.onload = e => resolve(e.target?.result as string);
                reader.onerror = e => reject(e);
                reader.readAsDataURL(file);
            });
    
            const croppedDataUrl = await cropImageToAspectRatio(dataUrl, aspectRatio);
    
            let updatedStoryboard = [...storyboard];
            updatedStoryboard[index].generated_image = croppedDataUrl;
            
            updatedStoryboard = invalidateAdjacentVideoPrompts(index, updatedStoryboard);
            
            setStoryboard(updatedStoryboard);
    
        } catch (e: any) {
            console.error("Failed to replace image:", e);
            setError(`替換圖片失敗: ${e.message}`);
        } finally {
            setRegeneratingIndex(null); 
        }
    };

    const handleDeleteShot = (index: number) => {
        const updatedStoryboard = [...storyboard];
        updatedStoryboard[index].isDeleted = true;

        const invalidationMessage = '相鄰鏡頭已刪除，提示詞已失效。';
        
        if (index > 0) {
            updatedStoryboard[index - 1].video_prompt = invalidationMessage;
        }

        updatedStoryboard[index].video_prompt = invalidationMessage;

        setStoryboard(updatedStoryboard);
        setEditingTarget(null); 
    };

    const handleUndoDeleteShot = (index: number) => {
        const updatedStoryboard = [...storyboard];
        updatedStoryboard[index].isDeleted = false;
        setStoryboard(updatedStoryboard);
    };
    
    const generateSingleVideoPrompt = async (index: number, board: any[], storyOutline: string, isImageToVideo: boolean, prioritizeFaces: boolean): Promise<string> => {
        let contents: any;
        const currentCut = board[index];
    
        const videoModelConstraintInstruction = prioritizeFaces ? `
**中低畫質模型特別指令 (Low-Quality Model Special Instruction):**
1.  **簡化動態 (Simplified Dynamics):** 動作必須是單一、清晰且有力的。例如「一個迴旋踢」、「施放一個火球」、「向前衝刺」。絕對禁止描述多個連續動作或複雜的武打套路。
2.  **明確運鏡 (Clear Camera Work):** 運鏡指令必須簡單直接。優先使用「緩慢推近 (slow push-in)」、「緩慢拉遠 (slow pull-out)」、「固定鏡頭 (static shot)」或「平穩的橫移 (smooth pan)」。避免快速、複雜或不穩定的攝影機運動。
3.  **豐富畫面 (Rich Scenery):** 儘管動作和運鏡被簡化，但場景本身必須是豐富的。請詳細描述光影、環境效果（如風、煙霧、火花）和角色表情，以避免畫面看起來像靜態的幻燈片。
` : '';
    
        let nextVisibleCut = null;
        for (let i = index + 1; i < board.length; i++) {
            if (!board[i].isDeleted) {
                nextVisibleCut = board[i];
                break;
            }
        }
    
        const isLastVisibleCut = !nextVisibleCut;
    
        if (!currentCut?.generated_image || (!isLastVisibleCut && !nextVisibleCut?.generated_image)) {
            throw new Error('缺少生成提示詞所需的圖片。');
        }
    
        if (isLastVisibleCut) {
            const lastImagePart = {
                inlineData: { data: currentCut.generated_image.split(',')[1], mimeType: 'image/png' }
            };
            
            // In Image-to-Video mode, the last shot is a self-contained story.
            // In normal mode, it's an epic finale.
            const endScenePrompt = isImageToVideo 
                ? `你是一位電影導演兼音效設計師。你的任務是根據這張「關鍵畫面」，為一個 6-8 秒的獨立短片撰寫影片提示詞。
**核心目標:** 創造一個有開頭、過程和結尾的完整場景，並將提供的「關鍵畫面」作為場景的最高潮或最終定格畫面。
**關鍵規則:**
1. **場景描述:** 描述在達到「關鍵畫面」之前發生的 4-6 秒動態過程。這必須是一個連貫的動作，而不是靜態的畫面。
2. **電影級運鏡:** 使用動態的攝影機運動來增強故事感。
3. **收尾:** 場景必須有明確的收尾，自然地結束在這個「關鍵畫面」上。
4. **音效設計 (Sound Design) - 必要項:** 必須描述符合場景氛圍的背景音樂 (BGM) 或關鍵音效。
${videoModelConstraintInstruction}
**故事背景:** 整體故事大綱為：「${storyOutline}」。
**輸出要求:**
- **格式:** 只需輸出最終的影片提示詞文字。
- **禁用詞彙:** 絕對禁止使用「過渡到」、「變形為」等詞彙。
- **輸出語言:** 必須使用繁體中文。`
                : `你是一位世界級的動作片導演，正在為一段序列創作史詩般的最後一鏡。你的任務是根據這張「最終畫面」和故事大綱，撰寫一段影片提示詞。
**核心目標:** 創造一個強大、難忘、持續 6-8 秒的收尾鏡頭，並在提供的「最終畫面」上結束。
**關鍵規則:**
1. **前導動作:** 鏡頭不能靜態開始。請描述在最終定格/狀態之前發生的 4-6 秒高潮動作。
2. **史詩級運鏡:** 以一個強力的攝影機運動結束。
3. **氛圍與情感:** 動作和運鏡必須根據故事大綱「${storyOutline}」喚起故事结局的預期情感。
4. **沉澱與定格:** 動作應告一段落，鏡頭的最後幾秒應「沉澱」至提供的「最終畫面」上。
${videoModelConstraintInstruction}
**輸出要求:**
- **格式:** 只需輸出最終的影片提示詞文字。
- **輸出語言:** 必須使用繁體中文。`;
            contents = { parts: [lastImagePart, { text: endScenePrompt }] };

        } else {
            const startImagePart = {
                inlineData: { data: currentCut.generated_image.split(',')[1], mimeType: 'image/png' }
            };
            const endImagePart = {
                inlineData: { data: nextVisibleCut.generated_image.split(',')[1], mimeType: 'image/png' }
            };
            const regenerationPrompt = `你是一位世界級的電影導演與視覺效果總監。你的任務是根據「起始畫面」和「結束畫面」，撰寫一段極度細緻且充滿動感的影片提示詞 (video_prompt)。

**情境設定:**
- **整體故事大綱:** "${storyOutline}" (此大綱僅供參考，用於設定場景的整體「調性」與「氛圍」，你絕對不能在這次的轉場中講完整個故事。)
- **當前片段位置:** 這是故事中的一個片段，連接鏡頭 #${currentCut.cut} 與鏡頭 #${nextVisibleCut.cut}。你的任務「僅限於」描述從「起始畫面」到「結束畫面」之間發生的事情。

**核心目標:**
創造一段驚心動魄、長達5秒的電影級序列，以「視覺上最直接且合乎邏輯」的方式，將兩個畫面無縫連接起來。你的描述必須嚴格基於這兩個畫面的內容。

**關鍵規則:**
1.  **嚴格的視覺連續性:** 你的描述必須解釋「起始畫面」中的角色/物件是如何透過一連串動作，最終達到「結束畫面」中的狀態與位置。不要添加這兩個畫面中不存在的關鍵情節或角色。
2.  **描述「過程」，而非「結果」:** 不要總結故事。例如，如果起始是「角色拔劍」，結束是「劍指敵人」，你應該描述揮劍與突刺的過程，而不是描述「角色打敗了敵人」。
3.  **高能量動作:** 過場絕不能是簡單的變形或緩慢的移動。請描述一連串高能量、有目的性的動作。
4.  **電影級運鏡:** 攝影機不是靜止的。請指定動態的攝影機運動（例如：跟拍、環繞、推軌）來增強動作的衝擊力。
5.  **填滿時長 (5 秒):** 所描述的動作序列必須足夠複雜與細緻，以自然地填滿5秒的畫面時間。
6.  **環境互動:** 角色/物體必須與「起始畫面」和「結束畫面」中可見的環境進行互動。

${videoModelConstraintInstruction}

**輸出要求:**
- **格式:** 只需輸出最終的影片提示詞文字。
- **禁用詞彙:** 絕對禁止使用「過渡到」、「變形為」、「出現」、「image_0」、「image_1」或任何類似的非劇情詞彙。
- **輸出語言:** 必須使用繁體中文。`;
            contents = { parts: [startImagePart, endImagePart, { text: regenerationPrompt }] };
        }
    
        const response = await ai.models.generateContent({
            model: 'gemini-2.5-flash',
            contents: contents
        });
    
        const newVideoPrompt = response.text;
        if (!newVideoPrompt) {
            throw new Error('模型未能生成新的影片提示詞。');
        }
        return newVideoPrompt.trim();
    };

    const handleRegenerateVideoPrompt = async (index: number) => {
        setRegeneratingVideoPromptIndex(index);
        setError('');
        try {
            const newPrompt = await generateSingleVideoPrompt(index, storyboard, outline, isImageToVideoMode, prioritizeFaceShots);
            const tempStoryboard = [...storyboard];
            tempStoryboard[index].video_prompt = newPrompt;
            setStoryboard(tempStoryboard);
        } catch (e: any) {
            console.error(e);
            setError(`鏡頭 #${index + 1} 影片提示詞重新生成失敗: ${e.message}`);
            const tempStoryboard = [...storyboard];
            tempStoryboard[index].video_prompt = `重新生成失敗，請再次嘗試。`;
            setStoryboard(tempStoryboard);
        } finally {
            setRegeneratingVideoPromptIndex(null);
        }
    };

    const handleOptimizeVideoPrompt = async (index: number) => {
        setOptimizingVideoPromptIndex(index);
        setError('');
        try {
            const tempStoryboard = [...storyboard];
            const currentCut = tempStoryboard[index];
            const userPrompt = currentCut.video_prompt;
    
            if (!userPrompt || userPrompt.trim().length === 0 || userPrompt === '待生成...' || getVideoPromptStatus(userPrompt) === 'status-error') {
                throw new Error('沒有可供優化的有效提示詞。');
            }
    
            let nextVisibleCut = null;
            for (let i = index + 1; i < tempStoryboard.length; i++) {
                if (!tempStoryboard[i].isDeleted) {
                    nextVisibleCut = tempStoryboard[i];
                    break;
                }
            }
            const isLastVisibleCut = !nextVisibleCut;
    
            const videoModelConstraintInstruction = prioritizeFaceShots ? `
**中低畫質模型特別指令 (Low-Quality Model Special Instruction):**
優化時請嚴格遵守以下規則：
1.  **簡化動態 (Simplified Dynamics):** 將複雜動作改寫為單一、清晰且有力的動作。
2.  **明確運鏡 (Clear Camera Work):** 將複雜運鏡改寫為簡單直接的運鏡方式，如緩慢推近、拉遠或平移。
3.  **豐富畫面 (Rich Scenery):** 在簡化動態的同時，增加光影、環境效果和角色表情的細節描述。
` : '';
    
            let parts: any[] = [];
            let optimizationMetaPrompt = '';
    
            if (isLastVisibleCut) {
                if (!currentCut?.generated_image) throw new Error('缺少優化提示詞所需的圖片。');
    
                const soundDesignInstruction = isImageToVideoMode 
                    ? `4. **音效設計 (Sound Design) - 必要項:** 必須描述符合場景氛圍的背景音樂 (BGM) 或關鍵音效。`
                    : '';
    
                optimizationMetaPrompt = `你是一位電影導演兼音效設計師。你的任務是根據「關鍵畫面」和「核心創意指導」，為一個 6-8 秒的獨立短片撰寫影片提示詞。

**核心創意指導 (使用者輸入):** "${userPrompt}"
- 這是這個場景希望表達的核心思想或動作。你的最終提示詞必須圍繞這個核心創意來擴寫與具象化。

**你的任務:**
將「核心創意指導」擴寫成一個有開頭、過程和結尾的完整場景，並將提供的「關鍵畫面」作為場景的最高潮或最終定格畫面。
1.  **場景描述:** 描述在達到「關鍵畫面」之前發生的 4-6 秒動態過程，這個過程必須體現「核心創意指導」。
2.  **電影級運鏡:** 使用動態的攝影機運動來增強故事感。
3.  **收尾:** 場景必須有明確的收尾，自然地結束在這個「關鍵畫面」上。
${soundDesignInstruction}

${videoModelConstraintInstruction}

**故事背景:** 整體故事大綱為：「${outline}」。

**輸出要求:**
- **格式:** 只需輸出最終的影片提示詞文字。
- **禁用詞彙:** 絕對禁止使用「過渡到」、「變形為」等詞彙。
- **輸出語言:** 必須使用繁體中文。`;
                
                const lastImagePart = { inlineData: { data: currentCut.generated_image.split(',')[1], mimeType: 'image/png' } };
                parts = [lastImagePart, { text: optimizationMetaPrompt }];
    
            } else {
                if (!currentCut?.generated_image || !nextVisibleCut?.generated_image) throw new Error('缺少優化提示詞所需的圖片。');
    
                optimizationMetaPrompt = `你是一位世界級的電影導演與視覺效果總監。你的任務是根據「起始畫面」、「結束畫面」以及「核心創意指導」，撰寫一段極度細緻且充滿動感的影片提示詞 (video_prompt)。

**情境設定:**
- **整體故事大綱:** "${outline}" (此大綱用於設定場景的整體「調性」與「氛圍」。)
- **當前片段:** 這是連接鏡頭 #${currentCut.cut} 與鏡頭 #${nextVisibleCut.cut} 的轉場。

**核心創意指導 (使用者輸入):** "${userPrompt}"
- 這是這個轉場的關鍵點子或希望看到的動作。你的最終提示詞必須圍繞這個核心創意來擴寫與具象化。

**你的任務:**
將「核心創意指導」擴寫成一段驚心動魄、長達5秒的電影級序列。你的描述必須：
1.  **忠於核心創意:** 嚴格圍繞使用者提供的指導思想進行創作。
2.  **創造視覺連續性:** 解釋「起始畫面」中的角色/物件是如何透過一連串動作，最終達到「結束畫面」中的狀態與位置。不要添加這兩個畫面中不存在的關鍵情節或角色。
3.  **描述「過程」，而非「結果」:** 專注於描述從起點到終點的動作過程。
4.  **加入電影級運鏡:** 指定動態的攝影機運動（例如：跟拍、環繞、推軌）來增強動作的衝擊力。
5.  **填滿時長 (5 秒):** 所描述的動作序列必須足夠複雜與細緻，以自然地填滿5秒的畫面時間。
6.  **豐富感官細節:** 增加環境互動（如塵土飛揚、水花四濺）、光影效果、角色表情等細節。

${videoModelConstraintInstruction}

**輸出要求:**
- **格式:** 只需輸出最終的影片提示詞文字。
- **禁用詞彙:** 絕對禁止使用「過渡到」、「變形為」、「出現」、「image_0」、「image_1」或任何類似的非劇情詞彙。
- **輸出語言:** 必須使用繁體中文。`;
                
                const startImagePart = { inlineData: { data: currentCut.generated_image.split(',')[1], mimeType: 'image/png' } };
                const endImagePart = { inlineData: { data: nextVisibleCut.generated_image.split(',')[1], mimeType: 'image/png' } };
                parts = [startImagePart, endImagePart, { text: optimizationMetaPrompt }];
            }
    
            const response = await ai.models.generateContent({
                model: 'gemini-2.5-flash',
                contents: { parts: parts }
            });
    
            const optimizedPrompt = response.text;
            if (!optimizedPrompt) {
                throw new Error('模型未能優化提示詞。');
            }
    
            tempStoryboard[index].video_prompt = optimizedPrompt.trim();
            setStoryboard(tempStoryboard);
    
        } catch (e: any) {
            console.error(e);
            setError(`鏡頭 #${index + 1} 影片提示詞優化失敗: ${e.message}`);
        } finally {
            setOptimizingVideoPromptIndex(null);
        }
    };

    const handleFixAllFailedVideoPrompts = async () => {
        const indicesToFix = storyboard
            .map((cut, index) => getVideoPromptStatus(cut.video_prompt) === 'status-error' && !cut.isDeleted ? index : -1)
            .filter(index => index !== -1);
        
        if (indicesToFix.length === 0) return;
    
        setIsLoading(true);
        setError('');
        const tempStoryboard = [...storyboard];
    
        try {
            for (let i = 0; i < indicesToFix.length; i++) {
                const index = indicesToFix[i];
                setLoadingMessage(`正在修復第 ${i + 1} / ${indicesToFix.length} 個失敗的轉場...`);
                
                try {
                    const newPrompt = await generateSingleVideoPrompt(index, tempStoryboard, outline, isImageToVideoMode, prioritizeFaceShots);
                    tempStoryboard[index].video_prompt = newPrompt;
                } catch (e: any) {
                     console.error(`自動修復影片提示詞失敗 (鏡頭 #${index + 1}):`, e);
                     tempStoryboard[index].video_prompt = `自動修復失敗: ${e.message}`;
                }
                setStoryboard([...tempStoryboard]);
            }
        } finally {
            setIsLoading(false);
            setLoadingMessage('');
        }
    };
    
    const handleReviewSingleVideoPrompt = async (index: number) => {
        const cut = storyboard[index];
        if (!cut || !cut.video_prompt || cut.video_prompt === '待生成...' || getVideoPromptStatus(cut.video_prompt) === 'status-error') {
            setError('沒有可供審查的有效提示詞。');
            return;
        }
    
        setReviewingVideoPromptIndex(index);
        setError('');
    
        try {
            const characterDescriptions = initialImages.length > 0
                ? initialImages.map((img, i) => `- ${img.tag}: 這是指第 ${i + 1} 張上傳的參考圖所代表的角色或物件。`).join('\n')
                : '無特定角色設定。';
    
            const reviewMetaPrompt = `你是一位經驗豐富的電影劇本總監 (Script Supervisor)。你的核心任務是確保影片的每一個細節都符合角色設定與整體故事大綱，維持絕對的連貫性。
    
    **情境:**
    你正在審查一段由 AI 生成的影片轉場提示詞。這段提示詞描述了從「起始畫面」到「結束畫面」的動態過程。然而，生成這段提示詞的 AI 可能只看到了圖片，而忽略了更高層次的劇情與角色背景。
    
    **你的審查目標:**
    1.  **角色一致性:** 確保提示詞中對角色的描述（名稱、能力、外觀、行為）與提供的「角色/物件設定」完全一致。如果 AI 叫錯了名字 (例如，把「天使長米迦勒」寫成了「精靈戰士」)，你必須修正它。
    2.  **劇情連貫性:** 確保提示詞中描述的動作與事件，符合「整體故事大綱」的邏輯與氛圍。修正任何與大綱相矛盾的情節。
    3.  **保留核心動態:** 在不違反上述兩點的前提下，盡量保留原始提示詞中的核心動作與運鏡。你的目標是「修正」而非「重寫」。
    
    **提供的資料:**
    *   **整體故事大綱:** "${outline}"
    *   **角色/物件設定:**
        ${characterDescriptions}
    *   **待審查的原始提示詞:** "${cut.video_prompt}"
    
    **你的任務:**
    請閱讀並分析所有提供的資料，然後輸出「修正後」的最終影片提示詞。
    
    **輸出要求:**
    - **格式:** 只需輸出修正後的影片提示詞文字。
    - **語言:** 必須使用繁體中文。
    - **禁止事項:** 不要添加任何解釋、評論或前言。直接輸出結果。`;
    
            const response = await ai.models.generateContent({
                model: 'gemini-2.5-flash',
                contents: reviewMetaPrompt
            });
    
            const reviewedPrompt = response.text;
            if (!reviewedPrompt) {
                throw new Error('模型未能生成審查後的新提示詞。');
            }
    
            const tempStoryboard = [...storyboard];
            tempStoryboard[index].video_prompt = reviewedPrompt.trim();
            setStoryboard(tempStoryboard);
    
        } catch (e: any) {
            console.error(e);
            setError(`鏡頭 #${index + 1} 劇本審查失敗: ${e.message}`);
        } finally {
            setReviewingVideoPromptIndex(null);
        }
    };
    
    const handleReviewAllVideoPrompts = async () => {
        const indicesToReview = storyboard
            .map((cut, index) => (!cut.isDeleted && cut.video_prompt && cut.video_prompt !== '待生成...' && getVideoPromptStatus(cut.video_prompt) !== 'status-error') ? index : -1)
            .filter(index => index !== -1);
    
        if (indicesToReview.length === 0) {
            setError("沒有可供審查的影片提示詞。");
            return;
        }
    
        setIsLoading(true);
        setError('');
        const tempStoryboard = [...storyboard];
    
        try {
            const characterDescriptions = initialImages.length > 0
                ? initialImages.map((img, i) => `- ${img.tag}: 這是指第 ${i + 1} 張上傳的參考圖所代表的角色或物件。`).join('\n')
                : '無特定角色設定。';
    
            for (let i = 0; i < indicesToReview.length; i++) {
                const index = indicesToReview[i];
                setLoadingMessage(`正在審查第 ${i + 1} / ${indicesToReview.length} 個影片提示詞...`);
                
                try {
                    const originalPrompt = tempStoryboard[index].video_prompt;
                    const reviewMetaPrompt = `你是一位經驗豐富的電影劇本總監 (Script Supervisor)。你的核心任務是確保影片的每一個細節都符合角色設定與整體故事大綱，維持絕對的連貫性。
    
    **情境:**
    你正在審查一段由 AI 生成的影片轉場提示詞。這段提示詞描述了從「起始畫面」到「結束畫面」的動態過程。然而，生成這段提示詞的 AI 可能只看到了圖片，而忽略了更高層次的劇情與角色背景。
    
    **你的審查目標:**
    1.  **角色一致性:** 確保提示詞中對角色的描述（名稱、能力、外觀、行為）與提供的「角色/物件設定」完全一致。如果 AI 叫錯了名字 (例如，把「天使長米迦勒」寫成了「精靈戰士」)，你必須修正它。
    2.  **劇情連貫性:** 確保提示詞中描述的動作與事件，符合「整體故事大綱」的邏輯與氛圍。修正任何與大綱相矛盾的情節。
    3.  **保留核心動態:** 在不違反上述兩點的前提下，盡量保留原始提示詞中的核心動作與運鏡。你的目標是「修正」而非「重寫」。
    
    **提供的資料:**
    *   **整體故事大綱:** "${outline}"
    *   **角色/物件設定:**
        ${characterDescriptions}
    *   **待審查的原始提示詞:** "${originalPrompt}"
    
    **你的任務:**
    請閱讀並分析所有提供的資料，然後輸出「修正後」的最終影片提示詞。
    
    **輸出要求:**
    - **格式:** 只需輸出修正後的影片提示詞文字。
    - **語言:** 必須使用繁體中文。
    - **禁止事項:** 不要添加任何解釋、評論或前言。直接輸出結果。`;
    
                    const response = await ai.models.generateContent({
                        model: 'gemini-2.5-flash',
                        contents: reviewMetaPrompt
                    });
    
                    const reviewedPrompt = response.text;
                    if (!reviewedPrompt) {
                        throw new Error('模型未能生成審查後的新提示詞。');
                    }
                    
                    tempStoryboard[index].video_prompt = reviewedPrompt.trim();
                    setStoryboard([...tempStoryboard]);
    
                } catch (e: any) {
                    console.error(`審查提示詞 #${index + 1} 失敗:`, e);
                    // Continue to the next one
                }
                
                if ((i + 1) % API_CALL_BATCH_SIZE === 0 && (i + 1) < indicesToReview.length) {
                    setLoadingMessage(`已審查 ${i + 1} 個提示詞，為避免觸發API速率限制，將等待 1 分鐘...`);
                    await new Promise(resolve => setTimeout(resolve, API_CALL_DELAY_MS));
                }
            }
        } catch (e: any) {
            setError(`批量劇本審查失敗: ${e.message}`);
        } finally {
            setIsLoading(false);
            setLoadingMessage('');
        }
    };

    const handleGenerate = async () => {
        if (initialImages.length === 0) {
            setError('請確保已上傳參考圖、填寫大綱並設定有效的鏡頭數量。');
            return;
        }
        if (!outline || numCuts <= 0) {
            setError('請確保已填寫大綱並設定有效的鏡頭數量。');
            return;
        }
        setIsLoading(true);
        setError('');
        setStoryboard([]);
        
        try {
            // --- PHASE 1: Generate Image Prompts ---
            setLoadingMessage('階段 1/3: 正在分析大綱並產生圖片腳本...');

            let imagePromptStyleInstruction = `風格要求為具有真實感的 "Raw photo"，請強調自然光影、細膩紋理與電影感。`;
            let modeSpecificInstruction = '';

            switch(generationMode) {
                case 'character_closeup':
                    modeSpecificInstruction = `**模式: 人物特寫** - 為每個鏡頭生成一個專注於角色臉部表情、情緒或與產品互動的特寫描述。請多使用「特寫」、「中景特寫」、「眼神專注於...」等攝影術語。`;
                    break;
                case 'character_in_scene':
                    modeSpecificInstruction = `**模式: 人與場景** - 為每個鏡頭生成一個描述角色與環境互動的場景。請著重於角色的動作、姿態，以及場景的氛圍與光影，使用如「中景」、「遠景」、「角色正在攀爬...」等術語。`;
                    break;
                case 'object_closeup':
                    modeSpecificInstruction = `**模式: 物件特寫** - 為每個鏡頭生成一個極致描繪物件或產品細節的描述。請專注於材質、光澤、紋理，使用如「微距鏡頭」、「細節特寫」、「光線掃過...」等術語。`;
                    break;
                case 'storytelling_scene':
                    modeSpecificInstruction = `**模式: 情境故事** - 為每個鏡頭生成一個包含人、物、景的完整故事化場景描述。請說明角色在做什麼、物件扮演的角色，以及環境如何烘托氣氛。`;
                    break;
                case 'animation':
                    imagePromptStyleInstruction = `風格要求為「高品質動畫風格 (High-quality anime style)」，請描述清晰的線條、鮮明的色彩、以及符合動畫美學的場景與角色動態。`;
                    modeSpecificInstruction = `**模式: 動畫風格** - 確保所有描述都符合動畫的視覺語言與世界觀。`;
                    break;
                case 'freestyle':
                    modeSpecificInstruction = `**模式: 無限制** - 你可以自由發揮，不受特定構圖或風格限制，創造最大膽、最有創意的畫面描述。`;
                    break;
            }

            let facePriorityInstruction = '';
            if (prioritizeFaceShots) {
                facePriorityInstruction = `
**臉部維持特別指令 (Face Priority Special Instruction):**
為了維持低畫質模型的人物臉部一致性，所有包含角色的鏡頭都必須優先採用「特寫 (Close-up)」、「中景 (Medium shot)」或「中特寫 (Medium close-up)」。絕對避免使用會讓角色臉部變得過小而無法辨識的「遠景 (Long shot)」或「大遠景 (Extreme long shot)」。`;
            }

            let finalShotInstruction = '';
            if (generationMode === 'character_closeup' && !isImageToVideoMode) {
                finalShotInstruction = `
**最後一鏡特別指令 (Final Shot Special Instruction):**
最後一個鏡頭 (鏡頭 #${numCuts}) 的 'image_prompt' 必須包含角色的清晰全身樣貌 (a clear, full-body shot of the character)，以確保觀眾能完整看見角色設計。`;
            }
            
            const continuityInstruction = isImageToVideoMode ?
                `**獨立場景 (Independent Scenes) - 重要規則:**
每個鏡頭都是一個獨立的故事單元，不需要與前後鏡頭有場景連貫性。請為每個鏡頭詳細描述其所需的完整視覺元素，包含主要角色、配角、怪物、背景、氛圍和構圖。` :
                `**場景連貫性(Scene Continuity) - 重要規則:**
1.  **避免突兀跳躍:** 除非故事大綱明確要求，否則相鄰的兩個鏡頭 (例如 鏡頭 1 和 鏡頭 2) 應該發生在相同或極為相似的場景中。
2.  **平滑過渡:** 如果需要轉換場景，請設計一個合理的過渡鏡頭。例如，角色從室內走向門口，下一個鏡頭才是室外。
3.  **保持背景一致:** 當主角在同一個地點執行一系列動作時，確保背景環境的細節保持一致。`;
            
            const imagePromptsJsonPrompt = `你是一個專業的電影導演和分鏡師。根據以下故事大綱、模式和指定的鏡頭數量，為每一個鏡頭產生一個JSON物件。
每一個鏡頭的JSON物件應只包含 'image_prompt'。

- 'image_prompt': 這是用來生成該鏡頭靜態圖片的提示詞。${imagePromptStyleInstruction}請專注於描述一個動作「正要開始」的瞬間，捕捉角色蓄勢待發的姿態或事件即將發生的緊張感。需要詳細描述場景、角色、構圖和氛圍。

${modeSpecificInstruction}
${continuityInstruction}
${facePriorityInstruction}
${finalShotInstruction}

故事大綱: "${outline}"
鏡頭總數: ${numCuts}
長寬比: "${aspectRatio}"

**語言:** 'image_prompt' 的內容必須使用繁體中文撰寫。
請嚴格遵循JSON格式，輸出一個包含 ${numCuts} 個物件的JSON陣列。`;
            
            const imagePromptsResponse = await ai.models.generateContent({
                model: "gemini-2.5-flash",
                contents: imagePromptsJsonPrompt,
                config: {
                    responseMimeType: "application/json",
                    responseSchema: {
                        type: Type.ARRAY,
                        items: {
                            type: Type.OBJECT,
                            properties: {
                                image_prompt: { type: Type.STRING },
                            },
                            required: ["image_prompt"]
                        }
                    }
                }
            });

            const text = imagePromptsResponse.text;
            if (!text) {
                const feedback = imagePromptsResponse?.promptFeedback;
                const blockReason = feedback?.blockReason;
                throw new Error(`API 未能生成有效的腳本。原因: ${blockReason || 'API 返回了空的回應'}`);
            }
            const generatedImagePrompts = JSON.parse(text);

            if (!Array.isArray(generatedImagePrompts) || generatedImagePrompts.length === 0) {
                throw new Error("API 未能生成有效的腳本，請調整大綱後再試。");
            }

            let tempStoryboard: any[] = generatedImagePrompts.map((promptData, i) => ({
                cut: i + 1,
                image_prompt: promptData.image_prompt,
                video_prompt: '待生成...',
                generated_image: '',
                isDeleted: false,
            }));
            setStoryboard([...tempStoryboard]);

            // --- PHASE 2: Generate Images ---
            for (let i = 0; i < tempStoryboard.length; i++) {
                setLoadingMessage(`階段 2/3: 正在生成第 ${i + 1} / ${tempStoryboard.length} 張分鏡圖...`);
                
                let finalImageUrl = '';

                try {
                    let finalImagePrompt = generateFinalImagePrompt(tempStoryboard[i].image_prompt, generationMode, aspectRatio, isImageToVideoMode, processedImages);
                    let fullDataUrl = '';
                    let attempt = 1;

                    while (attempt <= 2) { 
                        try {
                            const imageParts = processedImages.map(img => ({
                                inlineData: {
                                    data: img.dataUrl.split(',')[1],
                                    mimeType: 'image/png',
                                }
                            }));
                            const parts: any[] = [...imageParts, { text: finalImagePrompt }];

                            const imageResponse = await ai.models.generateContent({
                                model: 'gemini-2.5-flash-image',
                                contents: { parts: parts },
                                config: {
                                    responseModalities: [Modality.IMAGE],
                                },
                            });

                            let generatedImageBase64 = '';
                            const responseParts = imageResponse?.candidates?.[0]?.content?.parts;
                            if (responseParts) {
                                for (const part of responseParts) {
                                    if (part.inlineData) {
                                        generatedImageBase64 = part.inlineData.data;
                                        break;
                                    }
                                }
                            }

                            if (!generatedImageBase64) {
                                const feedback = imageResponse?.promptFeedback;
                                const blockReason = feedback?.blockReason;
                                if (blockReason === 'SAFETY' && attempt === 1) {
                                    console.warn(`鏡頭 ${i + 1} 因安全原因被阻擋。嘗試修正提示詞后重試...`);
                                    const sanitizationRequest = `以下圖片提示詞因安全原因被阻擋。請在保留原意的基礎上，將其改寫得更安全、更符合內容政策。原始提示詞： "${tempStoryboard[i].image_prompt}"`;
                                    const sanitizedResponse = await ai.models.generateContent({ model: 'gemini-2.5-flash', contents: sanitizationRequest });
                                    
                                    if (!sanitizedResponse.text) throw new Error('無法自動修正提示詞。');
                                    
                                    const sanitizedImagePrompt = sanitizedResponse.text.trim();
                                    tempStoryboard[i].image_prompt = sanitizedImagePrompt; 
                                    finalImagePrompt = generateFinalImagePrompt(sanitizedImagePrompt, generationMode, aspectRatio, isImageToVideoMode, processedImages);
                                    
                                    attempt++;
                                    continue;
                                }
                                throw new Error(`API返回空圖片。原因: ${blockReason || '未知'}`);
                            }

                            fullDataUrl = `data:image/png;base64,${generatedImageBase64}`;
                            break; 

                        } catch (e: any) {
                            if ((e.message.includes('429') || e.message.toLowerCase().includes('quota')) && attempt === 1) {
                                setLoadingMessage(`API用量限制。等待1分鐘後重試 (鏡頭 ${i + 1})...`);
                                await new Promise(resolve => setTimeout(resolve, 60000));
                                attempt++;
                                continue;
                            }
                            throw e; 
                        }
                    }
                    
                    if (fullDataUrl) {
                        finalImageUrl = await cropImageToAspectRatio(fullDataUrl, aspectRatio);
                    }

                } catch (e: any) {
                    console.warn(`鏡頭 ${i + 1} 未能生成圖片，即使在重試後。錯誤: ${e.message}`);
                    finalImageUrl = ''; 
                }

                tempStoryboard[i].generated_image = finalImageUrl;
                setStoryboard([...tempStoryboard]);

                if ((i + 1) % API_CALL_BATCH_SIZE === 0 && (i + 1) < tempStoryboard.length) {
                    setLoadingMessage(`已生成 ${i + 1} 張圖片，為避免觸發API速率限制，將等待 1 分鐘...`);
                    await new Promise(resolve => setTimeout(resolve, API_CALL_DELAY_MS));
                }
            }
            
            // --- PHASE 3: Generate Video Prompts ---
            setLoadingMessage('階段 3/3: 正在根據圖片生成過場提示詞...');
            for (let i = 0; i < tempStoryboard.length; i++) {
                if (tempStoryboard[i].isDeleted) continue;
                setLoadingMessage(`階段 3/3: 正在生成第 ${i + 1} / ${tempStoryboard.length} 段影片提示詞...`);
                try {
                    const newPrompt = await generateSingleVideoPrompt(i, tempStoryboard, outline, isImageToVideoMode, prioritizeFaceShots);
                    tempStoryboard[i].video_prompt = newPrompt;
                } catch(e: any) {
                    console.warn(`由於缺少圖片，已跳過 鏡頭 #${i + 1} 的影片提示詞生成。`);
                    tempStoryboard[i].video_prompt = "圖片生成失敗，無法產生影片提示詞。";
                }
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
    
    const handleImageUpload = (files: FileList) => {
        const newImages = Array.from(files).map((file, index) => {
            const id = Date.now() + index;
            const defaultTag = `角色 ${initialImages.length + index + 1}`;
            return new Promise<{ id: number, file: File, dataUrl: string, tag: string }>((resolve) => {
                const reader = new FileReader();
                reader.onload = (e) => {
                    const dataUrl = e.target?.result as string;
                    resolve({ id, file, dataUrl, tag: defaultTag });
                };
                reader.readAsDataURL(file);
            });
        });
    
        Promise.all(newImages).then(resolvedImages => {
            setInitialImages(prev => [...prev, ...resolvedImages]);
            setStoryboard([]);
            setError('');
            setIsProjectLoaded(false);
        });
    };

    const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const files = e.target.files;
        if (files && files.length > 0) handleImageUpload(files);
    };

    const handleImageTagChange = (id: number, newTag: string) => {
        setInitialImages(prev => prev.map(img => img.id === id ? { ...img, tag: newTag } : img));
        setProcessedImages(prev => prev.map(img => img.id === id ? { ...img, tag: newTag } : img));
    };
    
    const handleRemoveImage = (idToRemove: number) => {
        setInitialImages(prev => prev.filter(img => img.id !== idToRemove));
    };

    const handleModeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        setGenerationMode(e.target.value);
    };

    const handleAspectRatioChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        setAspectRatio(e.target.value);
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
            const files = e.dataTransfer?.files;
            if (files && files.length > 0) handleImageUpload(files);
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
    useEffect(setupDragAndDrop, [uploadAreaRef.current, initialImages]);

    const isFormValid = initialImages.length > 0 && outline && numCuts > 0;

    const getVideoPromptStatus = (videoPrompt: string) => {
        if (videoPrompt?.includes('失敗') || videoPrompt?.includes('失效')) {
            return 'status-error';
        }
        if (videoPrompt && videoPrompt !== '待生成...') {
            return 'status-success';
        }
        return ''; // Default status
    };
    
    const hasFailedVideoPrompts = storyboard.some(cut => !cut.isDeleted && getVideoPromptStatus(cut.video_prompt) === 'status-error');

    const lastVisibleIndex = storyboard.map(c => !c.isDeleted).lastIndexOf(true);

    const anyActionInProgress = isLoading || regeneratingIndex !== null || upscalingIndex !== null || regeneratingVideoPromptIndex !== null || optimizingVideoPromptIndex !== null || reviewingVideoPromptIndex !== null;

    return (
        <div className="container">
            <div className="header">
                <h1>分鏡稿產生器</h1>
            </div>

            <div className="input-section">
                <div className="form-group">
                    <label htmlFor="file-upload">1. 上傳參考圖片</label>
                    <div className="multi-upload-container">
                        <div className="uploaded-images-grid">
                            {processedImages.map((img) => (
                                <div key={img.id} className="uploaded-image-item">
                                    <img src={img.dataUrl} alt={img.tag} className="image-preview" />
                                    <input 
                                        type="text" 
                                        value={initialImages.find(i => i.id === img.id)?.tag || ''} 
                                        onChange={(e) => handleImageTagChange(img.id, e.target.value)}
                                        className="tag-input"
                                        placeholder="角色/物件名稱"
                                    />
                                    <button onClick={() => handleRemoveImage(img.id)} className="remove-btn">&times;</button>
                                </div>
                            ))}
                        </div>
                        <div ref={uploadAreaRef} className="upload-area" onClick={() => document.getElementById('file-upload')?.click()}>
                            <input type="file" id="file-upload" accept="image/*" onChange={handleFileChange} multiple />
                            <p>{initialImages.length > 0 ? '點擊或拖曳新增更多參考圖' : '點擊或拖曳圖片至此處'}</p>
                        </div>
                    </div>
                </div>
                <div className="form-group">
                    <label>2. 選擇長寬比</label>
                    <div className="radio-group">
                        <input type="radio" id="16-9" name="aspectRatio" value="16:9" checked={aspectRatio === '16:9'} onChange={handleAspectRatioChange} disabled={isProjectLoaded} />
                        <label htmlFor="16-9" title={isProjectLoaded ? "載入專案後無法更改長寬比" : ""}>16:9</label>
                        <input type="radio" id="9-16" name="aspectRatio" value="9:16" checked={aspectRatio === '9:16'} onChange={handleAspectRatioChange} disabled={isProjectLoaded} />
                        <label htmlFor="9-16" title={isProjectLoaded ? "載入專案後無法更改長寬比" : ""}>9:16</label>
                    </div>
                </div>
                <div className="form-group checkbox-group">
                     <input type="checkbox" id="image-to-video-mode" checked={isImageToVideoMode} onChange={e => setIsImageToVideoMode(e.target.checked)} disabled={isProjectLoaded} />
                     <label htmlFor="image-to-video-mode" title={isProjectLoaded ? "載入專案後無法更改模式" : "每個鏡頭都是獨立故事，從零生成圖片，並包含音效設計"}>圖生影片分鏡生成</label>
                </div>
                <div className="form-group checkbox-group">
                    <input type="checkbox" id="prioritize-face-shots" checked={prioritizeFaceShots} onChange={e => setPrioritizeFaceShots(e.target.checked)} disabled={isProjectLoaded} />
                    <label htmlFor="prioritize-face-shots" title="要求分鏡與畫面產生，人物均會有較大的臉部面積，即盡量減少過於遠景的描繪或鏡位。此類模型中，臉部過小容易造成畫面崩解或失去一致性。">中低畫質影片模型(人物臉部維持)</label>
                </div>
                <div className="form-group">
                    <label htmlFor="outline">3. 輸入故事大綱</label>
                    <textarea id="outline" value={outline} onChange={e => setOutline(e.target.value)} placeholder={outlinePlaceholders[generationMode]}></textarea>
                </div>
                <div className="form-group">
                    <label htmlFor="num-cuts">4. 設定鏡頭數量</label>
                    <input type="number" id="num-cuts" value={numCuts} onChange={e => setNumCuts(parseInt(e.target.value, 10) || 1)} min="1" />
                </div>
                <div className="form-group">
                    <label>5. 選擇生成模式 (廣告範本)</label>
                    <div className="radio-group">
                        <input type="radio" id="mode-character_closeup" name="generationMode" value="character_closeup" checked={generationMode === 'character_closeup'} onChange={handleModeChange} />
                        <label htmlFor="mode-character_closeup" title="強調角色表情、情緒與產品互動的特寫鏡頭。">人物特寫</label>
                        <input type="radio" id="mode-character_in_scene" name="generationMode" value="character_in_scene" checked={generationMode === 'character_in_scene'} onChange={handleModeChange} />
                        <label htmlFor="mode-character_in_scene" title="展現角色與場景的互動，強調氛圍與故事感的中遠景。">人與場景</label>
                        <input type="radio" id="mode-object_closeup" name="generationMode" value="object_closeup" checked={generationMode === 'object_closeup'} onChange={handleModeChange} />
                        <label htmlFor="mode-object_closeup" title="專注於產品或物件的細節、質感與光影，適合展示型廣告。">物件特寫</label>
                        <input type="radio" id="mode-storytelling_scene" name="generationMode" value="storytelling_scene" checked={generationMode === 'storytelling_scene'} onChange={handleModeChange} />
                        <label htmlFor="mode-storytelling_scene" title="結合人、物、景，營造一個完整的故事化場景。">情境故事</label>
                        <input type="radio" id="mode-animation" name="generationMode" value="animation" checked={generationMode === 'animation'} onChange={handleModeChange} />
                        <label htmlFor="mode-animation" title="優先保持動漫角色與畫風一致，適合動畫短片製作。">動畫風格</label>
                        <input type="radio" id="mode-freestyle" name="generationMode" value="freestyle" checked={generationMode === 'freestyle'} onChange={handleModeChange} />
                        <label htmlFor="mode-freestyle" title="不強制特徵一致性，給予AI最大創作自由度。">無限制</label>
                    </div>
                </div>
                <button className="btn btn-primary" onClick={handleGenerate} disabled={!isFormValid || anyActionInProgress}>
                    {isLoading ? '生成中...' : '生成分鏡'}
                </button>
                <div className="project-actions">
                    <button className="btn btn-secondary" onClick={handleSaveProject} disabled={initialImages.length === 0 || storyboard.length === 0}>儲存專案</button>
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
                        <button className="btn" onClick={handleFixAllFailedVideoPrompts} disabled={anyActionInProgress || !hasFailedVideoPrompts}>自動修復所有紅色箭頭</button>
                        <button className="btn" onClick={handleReviewAllVideoPrompts} disabled={anyActionInProgress} title="使用AI審查所有影片提示詞，確保其符合故事大綱與角色設定。">劇本審查與修正</button>
                        <button className="btn" onClick={handleUpscaleAllImages} disabled={anyActionInProgress} title="將所有生成圖片的解析度提升，可能需要較長時間。">升頻所有圖片</button>
                        <button className="btn" onClick={handleRegenerateImages} disabled={anyActionInProgress}>重新生成所有圖片</button>
                    </div>
                    <div className="storyboard-filmstrip-container">
                        <div className="storyboard-filmstrip">
                            {storyboard.map((cut, index) => {
                                let nextVisibleIndex = -1;
                                for (let i = index + 1; i < storyboard.length; i++) {
                                    if (!storyboard[i].isDeleted) {
                                        nextVisibleIndex = i;
                                        break;
                                    }
                                }
                                
                                return (
                                <div className="storyboard-item-wrapper" key={index}>
                                    <div className={`filmstrip-item filmstrip-image-item ${cut.isDeleted ? 'deleted-item' : ''}`} onClick={() => setEditingTarget({ type: 'image', index })}>
                                        <div className="filmstrip-item-header">
                                            <h3>鏡頭 #{cut.cut}</h3>
                                        </div>
                                        <div className="image-container">
                                            {(regeneratingIndex === index || upscalingIndex === index) && (
                                                <div className="image-overlay">
                                                    <div className="spinner"></div>
                                                    <span className="image-overlay-text">{upscalingIndex === index ? '升頻中...' : ''}</span>
                                                </div>
                                            )}
                                            {cut.generated_image ?
                                                <img
                                                    src={cut.generated_image}
                                                    alt={`鏡頭 ${cut.cut}`}
                                                    style={{ aspectRatio: aspectRatio.replace(':', ' / ') }}
                                                /> :
                                                <div className="image-placeholder" style={{ aspectRatio: aspectRatio.replace(':', ' / ') }}>
                                                    <span>{isLoading ? '生成中...' : '圖片尚未生成'}</span>
                                                </div>
                                            }
                                        </div>
                                    </div>

                                    {!cut.isDeleted && index < lastVisibleIndex && (
                                        <div className={`filmstrip-item filmstrip-arrow-item ${getVideoPromptStatus(cut.video_prompt)}`} onClick={() => setEditingTarget({ type: 'video', index })}>
                                            <div className="arrow-icon">
                                                {regeneratingVideoPromptIndex === index || optimizingVideoPromptIndex === index || reviewingVideoPromptIndex === index ? '⏳' : '➔'}
                                            </div>
                                        </div>
                                    )}

                                    {!cut.isDeleted && index === lastVisibleIndex && (
                                        <div className={`filmstrip-item filmstrip-end-item ${getVideoPromptStatus(cut.video_prompt)}`} onClick={() => setEditingTarget({ type: 'video', index })}>
                                            <div className="end-icon-wrapper">
                                                {regeneratingVideoPromptIndex === index || optimizingVideoPromptIndex === index || reviewingVideoPromptIndex === index ? (
                                                    <div className="spinner spinner-small"></div>
                                                ) : (
                                                    <svg width="40" height="40" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                                                        <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2"/>
                                                    </svg>
                                                )}
                                            </div>
                                        </div>
                                    )}
                                </div>
                            )})}
                        </div>
                    </div>
                </div>
            )}

            {editingTarget !== null && (
                <div className="editor-modal-overlay" onClick={() => setEditingTarget(null)}>
                    <div className="editor-modal-content" onClick={e => e.stopPropagation()}>
                        
                        {editingTarget.type === 'image' && (() => {
                            const cut = storyboard[editingTarget.index];
                            return (
                                <>
                                    <div className="editor-modal-header">
                                        <h2>編輯鏡頭 #{editingTarget.index + 1}</h2>
                                        <button onClick={() => setEditingTarget(null)} className="btn-icon close-button">&times;</button>
                                    </div>
                                    <div className="editor-modal-body">
                                        {cut.generated_image && <img src={cut.generated_image} alt={`鏡頭 ${cut.cut}`} className="modal-image-preview" />}
                                        <div className="prompt-area">
                                            <label>圖片提示詞</label>
                                            <textarea
                                                className="prompt-text editable"
                                                value={cut.image_prompt}
                                                onChange={(e) => handleImagePromptChange(editingTarget.index, e.target.value)}
                                                rows={5}
                                                disabled={cut.isDeleted}
                                            />
                                        </div>
                                    </div>
                                    <div className="editor-modal-footer">
                                        {cut.isDeleted ? (
                                            <button className="btn btn-secondary" onClick={() => handleUndoDeleteShot(editingTarget.index)}>
                                                還原鏡頭
                                            </button>
                                        ) : (
                                            <>
                                                <button className="btn btn-danger" onClick={() => handleDeleteShot(editingTarget.index)}>
                                                    刪除鏡頭
                                                </button>
                                                <input 
                                                    type="file" 
                                                    id={`replace-image-input-${editingTarget.index}`}
                                                    accept="image/*" 
                                                    onChange={(e) => {
                                                        const file = e.target.files?.[0];
                                                        if (file) {
                                                            handleReplaceImage(editingTarget.index, file);
                                                            e.target.value = '';
                                                        }
                                                    }}
                                                    style={{ display: 'none' }} 
                                                />
                                                <label htmlFor={`replace-image-input-${editingTarget.index}`} className="btn btn-secondary">
                                                    更換圖片
                                                </label>
                                                {editingTarget.index > 0 && storyboard[editingTarget.index - 1]?.generated_image && !isImageToVideoMode && (
                                                    <button
                                                        className="btn btn-secondary"
                                                        onClick={() => handleExtendAndCorrectImage(editingTarget.index)}
                                                        disabled={anyActionInProgress}
                                                        title="以上一個鏡頭為參考圖進行生成，適合連貫的動作場景。"
                                                    >
                                                        {'↔️ 延伸修正'}
                                                    </button>
                                                )}
                                                <button
                                                    className="btn btn-secondary"
                                                    onClick={() => handleUpscaleSingleImage(editingTarget.index)}
                                                    disabled={anyActionInProgress || !cut.generated_image}
                                                    title="使用 AI 提升此圖片的解析度與細節，同時保持內容不變。"
                                                >
                                                    {upscalingIndex === editingTarget.index ? '升頻中...' : 'UHD 升頻'}
                                                </button>
                                                <button
                                                    className="btn btn-primary"
                                                    onClick={() => handleRegenerateSingleImage(editingTarget.index)}
                                                    disabled={anyActionInProgress}
                                                >
                                                    {regeneratingIndex === editingTarget.index ? '生成中...' : '🔄 重新生成此圖片'}
                                                </button>
                                            </>
                                        )}
                                    </div>
                                </>
                            );
                        })()}

                        {editingTarget.type === 'video' && (() => {
                            const cut = storyboard[editingTarget.index];
                             // Correctly find the next visible cut to ensure logical consistency
                            let nextVisibleCut = null;
                            for (let i = editingTarget.index + 1; i < storyboard.length; i++) {
                                if (!storyboard[i].isDeleted) {
                                    nextVisibleCut = storyboard[i];
                                    break;
                                }
                            }
                            const isLastVisibleCut = editingTarget.index === lastVisibleIndex;

                            const headerText = isLastVisibleCut
                                ? `編輯影片提示詞 (鏡頭 #${cut.cut} 收尾)`
                                : `編輯影片提示詞 (鏡頭 #${cut.cut} → #${nextVisibleCut?.cut})`;
                            
                            return (
                                <>
                                    <div className="editor-modal-header">
                                        <h2>{headerText}</h2>
                                        <button onClick={() => setEditingTarget(null)} className="btn-icon close-button">&times;</button>
                                    </div>
                                    <div className="editor-modal-body">
                                        <div className="prompt-area">
                                            <label>影片提示詞 (可編輯)</label>
                                            <textarea
                                                className="prompt-text editable"
                                                value={cut.video_prompt}
                                                onChange={(e) => handleVideoPromptChange(editingTarget.index, e.target.value)}
                                                rows={8}
                                            />
                                            <div className="modal-copy-button-container">
                                                <button className={`btn btn-copy ${copiedStates[editingTarget.index] ? '✓ 已複製' : ''}`} onClick={() => handleCopy(cut.video_prompt, editingTarget.index)}>
                                                    {copiedStates[editingTarget.index] ? '✓ 已複製' : '複製提示詞'}
                                                </button>
                                            </div>
                                        </div>
                                    </div>
                                    <div className="editor-modal-footer">
                                         <button
                                            className="btn btn-secondary"
                                            onClick={() => handleReviewSingleVideoPrompt(editingTarget.index)}
                                            disabled={anyActionInProgress || !cut.video_prompt || getVideoPromptStatus(cut.video_prompt) === 'status-error'}
                                            title="讓 AI 根據故事大綱與角色設定，審查並修正此提示詞的連貫性。"
                                        >
                                            {reviewingVideoPromptIndex === editingTarget.index ? '審查中...' : '📝 AI 劇本審查'}
                                        </button>
                                         <button
                                            className="btn btn-secondary"
                                            onClick={() => handleOptimizeVideoPrompt(editingTarget.index)}
                                            disabled={anyActionInProgress || !cut.video_prompt || getVideoPromptStatus(cut.video_prompt) === 'status-error'}
                                            title="讓 AI 根據您目前的修改，進一步優化提示詞"
                                        >
                                            {optimizingVideoPromptIndex === editingTarget.index ? '優化中...' : '🧠 AI 優化提示詞'}
                                        </button>
                                        <button
                                            className="btn btn-primary"
                                            onClick={() => handleRegenerateVideoPrompt(editingTarget.index)}
                                            disabled={anyActionInProgress || !cut.generated_image || (!isLastVisibleCut && !nextVisibleCut?.generated_image)}
                                            title={isLastVisibleCut ? "根據此圖片，重新生成收尾的影片提示詞" : "根據前後圖片，重新生成更流暢的影片提示詞"}
                                        >
                                            {regeneratingVideoPromptIndex === editingTarget.index ? '生成中...' : '✨ 重新生成提示詞'}
                                        </button>
                                    </div>
                                </>
                            );
                        })()}
                    </div>
                </div>
            )}
        </div>
    );
};

const root = ReactDOM.createRoot(document.getElementById('root')!);
root.render(<App />);