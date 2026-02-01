// Immediately check for TensorFlow.js and Handpose global objects
if (typeof tf === 'undefined') {
    console.error("HOLO-Gen1 FATAL ERROR: TensorFlow.js (tf) IS NOT DEFINED. Check CDN script tags in index.html and Network tab.");
    const loadingMsg = document.getElementById("loading-message");
    if (loadingMsg) loadingMsg.textContent = "Error: TensorFlow.js library failed to load. Check console.";
    throw new Error("TensorFlow.js (tf) not loaded.");
} else {
    console.log("HOLO-Gen1 INLINE LOG: TensorFlow.js (tf) object IS defined.");
}

if (typeof handpose === 'undefined') {
    console.error("HOLO-Gen1 FATAL ERROR: Handpose model IS NOT DEFINED. Check CDN script tag for @tensorflow-models/handpose and Network tab.");
    const loadingMsg = document.getElementById("loading-message");
    if (loadingMsg) loadingMsg.textContent = "Error: Handpose model library failed to load. Check console.";
    throw new Error("Handpose model not loaded.");
} else {
    console.log("HOLO-Gen1 INLINE LOG: Handpose object IS defined.");
}

// Check for THREE object (assuming it's loaded locally by index.html before this script)
if (typeof THREE === 'undefined') {
    console.error("HOLO-Gen1 FATAL ERROR: THREE object IS NOT DEFINED. Ensure js/three.min.js is present and correctly linked in index.html. Check Network tab.");
    const loadingMsg = document.getElementById("loading-message");
    if (loadingMsg) loadingMsg.textContent = "Error: Three.js library failed to load. Check console.";
    throw new Error("Three.js (THREE) not loaded.");
} else {
     console.log("HOLO-Gen1 INLINE LOG: THREE object IS defined (checked from app.js).");
}

// --- DOM Elements ---
console.log("HOLO-Gen1 LOG: Querying DOM Elements...");
const video = document.getElementById("webcam-video");
const videoContainer = document.getElementById("video-container");
const noCameraFallback = document.getElementById("no-camera-fallback");
const threeJsContainer = document.getElementById("threejs-container");
const loadingOverlay = document.getElementById("loading-overlay");
const loadingMessage = document.getElementById("loading-message");

const permissionModal = document.getElementById("permission-modal-overlay");
const grantCameraButton = document.getElementById("grant-camera-button");
const helpModal = document.getElementById("help-modal-overlay");
const helpButton = document.getElementById("help-btn");
const closeHelpModalButton = document.getElementById("close-help-modal-btn");

const handPresenceLabel = document.getElementById("hand-presence-label");
const captureImageButton = document.getElementById("capture-image-btn");
const clearAllButton = document.getElementById("clear-all-btn"); // Renamed in HTML to "Clear 3D View"

// Check if crucial DOM elements exist
const criticalDOMElements = {
    video, videoContainer, noCameraFallback, threeJsContainer, loadingOverlay,
    loadingMessage, permissionModal, grantCameraButton, helpModal, helpButton,
    closeHelpModalButton, handPresenceLabel, captureImageButton, clearAllButton
};

for (const [key, element] of Object.entries(criticalDOMElements)) {
    if (!element) {
        const elementId = key.replace(/([A-Z])/g, '-$1').toLowerCase(); // Simple conversion
        console.error(`HOLO-Gen1 FATAL ERROR: DOM Element with ID '${elementId}' not found! Check index.html.`);
        if (loadingMessage) loadingMessage.textContent = `Error: HTML element '${elementId}' missing. App cannot start.`;
        throw new Error(`DOM Element '${elementId}' not found.`);
    }
}
console.log("HOLO-Gen1 LOG: All critical DOM Elements queried successfully.");

// --- Global State ---
let handposeModel;
let webcamRunning = false;
const MAX_HANDS_TFJS = 2; // Render up to 2 hands

// --- Three.js Variables ---
let scene, camera, renderer;
const handMeshes3D = [null, null]; // For two hands
const handLandmarkPoints3D = [[], []];
const handBoneLines3D = [[], []];

const HAND_COLOR_PRIMARY = 0x00ffff;   // Cyan
const HAND_COLOR_SECONDARY = 0xff00ff; // Magenta
const POINT_SIZE = 0.01;
const LINE_THICKNESS = 2;

const HAND_CONNECTIONS_TFJS = [
    [0, 1], [1, 2], [2, 3], [3, 4], // Thumb
    [0, 5], [5, 6], [6, 7], [7, 8], // Index
    [0, 9], [9, 10], [10, 11], [11, 12], // Middle
    [0, 13], [13, 14], [14, 15], [15, 16], // Ring
    [0, 17], [17, 18], [18, 19], [19, 20], // Pinky
    [5,9], [9,13], [13,17] // Palm
];

// --- Initialization ---
document.addEventListener('DOMContentLoaded', initApp);

async function initApp() {
    showLoading("Initializing HOLO-Gen1 Hand Tracking...");
    console.log("HOLO-Gen1 LOG: initApp started (TF.js - Simplified).");
    setupEventListeners();

    try {
        console.log("HOLO-Gen1 LOG: Setting TF.js backend...");
        await tf.setBackend('webgl');
        console.log("HOLO-Gen1 LOG: TF.js backend set to WebGL.");

        console.log("HOLO-Gen1 LOG: Attempting to load Handpose model...");
        await loadHandposeModel();
        console.log("HOLO-Gen1 LOG: Handpose model loaded.");

        console.log("HOLO-Gen1 LOG: Attempting to initialize Three.js scene...");
        initThreeScene();
        console.log("HOLO-Gen1 LOG: Three.js scene initialized.");

        showPermissionModal();
        console.log("HOLO-Gen1 LOG: Permission modal requested.");

    } catch (error) {
        console.error("HOLO-Gen1 ERROR: Critical initialization failed in initApp:", error);
        showLoading(`App Init Error: ${error.message || 'Unknown error'}. Check console.`);
        if (noCameraFallback) {
            noCameraFallback.style.display = "block";
            noCameraFallback.innerHTML = `<p>⚠️ Application Initialization Failed: ${error.message || 'Unknown error'}</p><p>Please check the browser console for details.</p>`;
            if (videoContainer) videoContainer.style.alignItems = "center";
        }
    }
}

function setupEventListeners() {
    console.log("HOLO-Gen1 LOG: Setting up event listeners.");
    grantCameraButton.addEventListener("click", handleGrantCameraAccess);
    helpButton.addEventListener("click", () => {
        console.log("HOLO-Gen1 LOG: Help button clicked.");
        helpModal.style.display = "flex";
    });
    closeHelpModalButton.addEventListener("click", () => {
        console.log("HOLO-Gen1 LOG: Close help modal button clicked.");
        helpModal.style.display = "none";
    });
    captureImageButton.addEventListener("click", handleCaptureImage);
    clearAllButton.addEventListener("click", handleClear3DView); // Changed function name
    window.addEventListener('resize', onWindowResizeThree, false);
    console.log("HOLO-Gen1 LOG: Event listeners setup complete.");
}

// --- TensorFlow.js Handpose Model ---
async function loadHandposeModel() {
    showLoading("Loading Handpose model...");
    console.log("HOLO-Gen1 LOG: loadHandposeModel - Start");
    try {
        handposeModel = await handpose.load();
        console.log("HOLO-Gen1 LOG: loadHandposeModel - Handpose model weights loaded successfully.");
    } catch (error) {
        console.error("HOLO-Gen1 ERROR: Failed to load Handpose model weights:", error);
        throw error;
    }
}

// --- Webcam Handling ---
function showPermissionModal() {
    hideLoading();
    console.log("HOLO-Gen1 LOG: Displaying permission modal.");
    permissionModal.style.display = "flex";
}

async function handleGrantCameraAccess() {
    console.log("HOLO-Gen1 LOG: handleGrantCameraAccess called.");
    permissionModal.style.display = "none";
    showLoading("Attempting to access camera...");

    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        console.error("HOLO-Gen1 ERROR: getUserMedia not supported.");
        handleCameraError(new Error("getUserMedia not supported on this browser."));
        return;
    }

    try {
        const stream = await navigator.mediaDevices.getUserMedia({
            video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: "user" }
        });
        console.log("HOLO-Gen1 LOG: Camera stream obtained.");
        video.srcObject = stream;
        video.addEventListener("loadeddata", () => {
            console.log("HOLO-Gen1 LOG: Video loadeddata event fired.");
            video.width = video.videoWidth;
            video.height = video.videoHeight;
            startPredictionLoop();
        });
        hideLoading();
        webcamRunning = true;
        noCameraFallback.style.display = "none";
    } catch (err) {
        console.error("HOLO-Gen1 ERROR: Camera access denied or error during getUserMedia:", err);
        handleCameraError(err);
    }
}

function handleCameraError(error) {
    console.error("HOLO-Gen1 ERROR: Camera Error Handler:", error);
    hideLoading();
    if (videoContainer) videoContainer.style.alignItems = "center";
    if (noCameraFallback) {
        noCameraFallback.style.display = "block";
        if (error.name === "NotAllowedError" || error.name === "PermissionDeniedError") {
            noCameraFallback.innerHTML = "<p>⚠️ Camera access denied by user.</p><p>Please enable camera permissions in your browser settings and refresh.</p>";
        } else if (error.name === "NotFoundError" || error.name === "DevicesNotFoundError"){
            noCameraFallback.innerHTML = "<p>⚠️ No camera found.</p><p>Please connect a camera and refresh the page.</p>";
        } else {
             noCameraFallback.innerHTML = `<p>⚠️ Error accessing camera: ${error.name || 'Unknown Error'}</p><p>Try refreshing or checking camera connections.</p>`;
        }
    }
    webcamRunning = false;
}

function startPredictionLoop() {
    if (!webcamRunning) webcamRunning = true;
    console.log("HOLO-Gen1 LOG: Starting prediction loop (TF.js).");
    predictWebcamTFJS();
}

// --- Prediction Loop & Result Processing (TensorFlow.js) ---
async function predictWebcamTFJS() {
    if (!webcamRunning || !handposeModel || !video || video.paused || video.ended || video.readyState < 2) {
        if (webcamRunning) requestAnimationFrame(predictWebcamTFJS);
        return;
    }

    const predictions = await handposeModel.estimateHands(video, { flipHorizontal: false });
    processHandposeResults(predictions);
    requestAnimationFrame(predictWebcamTFJS);
}

function processHandposeResults(predictions) {
    if (handPresenceLabel) {
        handPresenceLabel.textContent = `Hands: ${predictions.length > 0 ? predictions.length + ' Detected' : 'Not Detected'}`;
    }
    handMeshes3D.forEach(mesh => { if (mesh) mesh.visible = false; });

    if (predictions.length > 0) {
        for (let i = 0; i < Math.min(predictions.length, MAX_HANDS_TFJS); i++) {
            const keypoints = predictions[i].landmarks;
            if (handMeshes3D[i]) {
                update3DHandModelTFJS(keypoints, i);
                handMeshes3D[i].visible = true;
            }
        }
    }
    if (scene && camera && renderer) renderer.render(scene, camera);
}

// --- Three.js 3D Hand Mirror ---
function initThreeScene() {
    console.log("HOLO-Gen1 LOG: initThreeScene - Start");
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x000000);

    const aspect = threeJsContainer.clientWidth / threeJsContainer.clientHeight || (4/3);
    camera = new THREE.PerspectiveCamera(60, aspect, 0.01, 20);
    camera.position.set(0, 0.2, 0.7);
    camera.lookAt(0, 0.1, 0);

    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setSize(threeJsContainer.clientWidth, threeJsContainer.clientHeight || threeJsContainer.clientWidth * (3/4));
    renderer.setPixelRatio(window.devicePixelRatio);
    threeJsContainer.appendChild(renderer.domElement);

    const ambientLight = new THREE.AmbientLight(0xffffff, 0.8);
    scene.add(ambientLight);
    const directionalLight = new THREE.DirectionalLight(0xffffff, 0.7);
    directionalLight.position.set(1, 1, 1);
    scene.add(directionalLight);

    for (let i = 0; i < MAX_HANDS_TFJS; i++) {
        handMeshes3D[i] = createSingleHand3DStructure(i === 0 ? HAND_COLOR_PRIMARY : HAND_COLOR_SECONDARY);
        handMeshes3D[i].visible = false;
        scene.add(handMeshes3D[i]);
    }
    onWindowResizeThree();
    console.log("HOLO-Gen1 LOG: initThreeScene - Complete");
}

function createSingleHand3DStructure(color) {
    const handGroup = new THREE.Group();
    const landmarkMaterial = new THREE.MeshPhongMaterial({
        color: color, emissive: color, emissiveIntensity: 0.7, shininess: 90,
    });
    const landmarkGeometry = new THREE.SphereGeometry(POINT_SIZE, 10, 10);

    const pointsArray = [];
    for (let j = 0; j < 21; j++) {
        const landmarkSphere = new THREE.Mesh(landmarkGeometry, landmarkMaterial);
        pointsArray.push(landmarkSphere);
        handGroup.add(landmarkSphere);
    }

    const boneMaterial = new THREE.LineBasicMaterial({
        color: color, linewidth: LINE_THICKNESS, transparent: true, opacity: 0.9,
    });

    const linesArray = [];
    HAND_CONNECTIONS_TFJS.forEach(() => {
        const geometry = new THREE.BufferGeometry();
        const positions = new Float32Array(2 * 3);
        geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        const boneLine = new THREE.Line(geometry, boneMaterial);
        linesArray.push(boneLine);
        handGroup.add(boneLine);
    });

    const handIndex = (color === HAND_COLOR_PRIMARY) ? 0 : 1;
    handLandmarkPoints3D[handIndex] = pointsArray;
    handBoneLines3D[handIndex] = linesArray;
    return handGroup;
}

function update3DHandModelTFJS(keypoints, handIdx) {
    const meshGroup = handMeshes3D[handIdx];
    if (!meshGroup || !handLandmarkPoints3D[handIdx] || !handBoneLines3D[handIdx]) return;

    const pointsToUpdate = handLandmarkPoints3D[handIdx];
    const linesToUpdate = handBoneLines3D[handIdx];
    const videoWidth = video.videoWidth;
    const videoHeight = video.videoHeight;

    if (!videoWidth || !videoHeight) return;

    const SCENE_SCALE_X = 1.0 / videoWidth;
    const SCENE_SCALE_Y = 1.0 / videoHeight;
    const SCENE_SCALE_Z = 0.001; // Handpose Z is less distinct, scale accordingly

    keypoints.forEach((landmark, i) => {
        if (pointsToUpdate[i]) {
            // Normalize and map to 3D space
            // X: Handpose X is 0 (left of video) to videoWidth (right). Video display is mirrored.
            // To match mirrored video, a small X from Handpose (user's right hand, left on sensor)
            // should appear on the right in 3D (+X). (videoWidth - landmark[0])
            pointsToUpdate[i].position.x = (videoWidth - landmark[0]) * SCENE_SCALE_X - 0.5;
            // Y: Handpose Y is 0 (top of video) to videoHeight (bottom). Three.js Y is 0 (center) to + (up).
            pointsToUpdate[i].position.y = -(landmark[1] * SCENE_SCALE_Y - 0.5);
            // Z: Handpose Z is relative. Smaller Z is closer.
            pointsToUpdate[i].position.z = -landmark[2] * SCENE_SCALE_Z;
        }
    });

    HAND_CONNECTIONS_TFJS.forEach((connection, boneIndex) => {
        if (linesToUpdate[boneIndex] && pointsToUpdate[connection[0]] && pointsToUpdate[connection[1]]) {
            const startPoint = pointsToUpdate[connection[0]].position;
            const endPoint = pointsToUpdate[connection[1]].position;
            const positions = linesToUpdate[boneIndex].geometry.attributes.position.array;
            positions[0] = startPoint.x; positions[1] = startPoint.y; positions[2] = startPoint.z;
            positions[3] = endPoint.x; positions[4] = endPoint.y; positions[5] = endPoint.z;
            linesToUpdate[boneIndex].geometry.attributes.position.needsUpdate = true;
        }
    });
}

function onWindowResizeThree() {
    if (camera && renderer && threeJsContainer) {
        const containerWidth = threeJsContainer.clientWidth;
        let containerHeight = threeJsContainer.clientHeight;
        if (containerHeight <= 10 || !containerHeight) {
            containerHeight = containerWidth * (3 / 4);
            if (threeJsContainer.style) threeJsContainer.style.height = `${containerHeight}px`;
        }
        camera.aspect = containerWidth / containerHeight;
        camera.updateProjectionMatrix();
        renderer.setSize(containerWidth, containerHeight);
        console.log(`HOLO-Gen1 LOG: Three.js resized to ${containerWidth}x${containerHeight}`);
    }
}

// --- Action Button Handlers (Simplified) ---
async function handleCaptureImage() {
    showLoading("Capturing image...");
    console.log("HOLO-Gen1 LOG: handleCaptureImage called.");
    try {
        const videoCanvas = document.createElement('canvas');
        videoCanvas.width = video?.videoWidth || 640;
        videoCanvas.height = video?.videoHeight || 480;
        const videoCtx = videoCanvas.getContext('2d');
        if (video && video.videoWidth > 0) {
            videoCtx.translate(videoCanvas.width, 0);
            videoCtx.scale(-1, 1);
            videoCtx.drawImage(video, 0, 0, videoCanvas.width, videoCanvas.height);
        } else {
            console.warn("HOLO-Gen1 WARN: Video dimensions not available for capture. Drawing placeholder.");
            videoCtx.fillStyle = '#1a1a3a';
            videoCtx.fillRect(0, 0, videoCanvas.width, videoCanvas.height);
            videoCtx.fillStyle = '#e0e0e0';
            videoCtx.font = '16px Rajdhani';
            videoCtx.textAlign = 'center';
            videoCtx.fillText("Live Feed Not Available", videoCanvas.width / 2, videoCanvas.height / 2);
        }
        const videoDataUrl = videoCanvas.toDataURL('image/png');

        if (renderer && scene && camera) renderer.render(scene, camera);
        const threeJsDataUrl = renderer?.domElement?.toDataURL('image/png') || createPlaceholderDataUrl(threeJsContainer?.clientWidth || 640, threeJsContainer?.clientHeight || 480, "3D Mirror Not Available");

        downloadImage(videoDataUrl, 'hologen1_live_feed.png');
        await new Promise(resolve => setTimeout(resolve, 200));
        downloadImage(threeJsDataUrl, 'hologen1_3d_mirror.png');
        console.log("HOLO-Gen1 LOG: Images captured and download prompted.");

    } catch (error) {
        console.error("HOLO-Gen1 ERROR: Error capturing image:", error);
        alert("Could not capture image. See console for details.");
    } finally {
        hideLoading();
    }
}

function createPlaceholderDataUrl(width, height, text) {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#1a1a3a';
    ctx.fillRect(0, 0, width, height);
    ctx.fillStyle = '#e0e0e0';
    ctx.font = '20px Rajdhani';
    ctx.textAlign = 'center';
    ctx.fillText(text, width / 2, height / 2);
    return canvas.toDataURL('image/png');
}

function downloadImage(dataUrl, filename) {
    const link = document.createElement('a');
    link.href = dataUrl;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
}

function handleClear3DView() { // Renamed from handleClearAllData
    console.log("HOLO-Gen1 LOG: handleClear3DView called.");
    handMeshes3D.forEach(mesh => { if (mesh) mesh.visible = false; });
    if (handPresenceLabel) handPresenceLabel.textContent = "Hands: Not Detected";
    if (renderer && scene && camera) renderer.render(scene, camera);
    console.log("HOLO-Gen1 LOG: 3D view cleared.");
}

// --- Utility Functions ---
function showLoading(message) {
    if (loadingOverlay) {
        if(loadingMessage) loadingMessage.textContent = message;
        loadingOverlay.style.display = "flex";
    }
}

function hideLoading() {
    if (loadingOverlay) {
        loadingOverlay.style.display = "none";
    }
}
