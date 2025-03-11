import {Box, IconButton, Sheet, Typography} from "@mui/joy";
import PlayArrowRoundedIcon from "@mui/icons-material/PlayArrowRounded";
import PauseRoundedIcon from "@mui/icons-material/PauseRounded";
import StopRoundedIcon from "@mui/icons-material/StopRounded";
import PowerSettingsNewIcon from "@mui/icons-material/PowerSettingsNew";
import CircularProgress from "@mui/joy/CircularProgress";
import {useState, useEffect, useRef} from "react";
import {io} from "socket.io-client";

const API_URL = "http://127.0.0.1:5001";
const socket = io(API_URL);

const MOUTH_STATES = {
    "10": "10",
    "20": "20",
    "30": "30",
    "40": "40",
    "50": "50"
};

type AudioSegment = {
    audio: ArrayBuffer;
    text: string;
    character: Character;
    startTime: number;
    duration: number;
};

type Character = {
    name: string;
    avatar_url: string;
    description: string;
    mouth_positions: {
        [key in typeof MOUTH_STATES[keyof typeof MOUTH_STATES]]: string;
    };
};


export function PodcastInterface() {
    const [characters, setCharacters] = useState<Character[]>([]);
    const [isPlaying, setIsPlaying] = useState(false);
    const [currentText, setCurrentText] = useState("");
    const [currentCharacter, setCurrentCharacter] = useState<Character | null>(null);
    const [currentMouthState, setCurrentMouthState] = useState(MOUTH_STATES["50"]);

    const audioContextRef = useRef<AudioContext | null>(null);
    const analyserRef = useRef<AnalyserNode | null>(null);
    const currentSourceNode = useRef<AudioBufferSourceNode | null>(null);
    const animationFrameRef = useRef<number>();
    const audioBufferQueue = useRef<Array<{
        buffer: AudioBuffer;
        text: string;
        character: Character;
    }>>([]);
    const isProcessingQueue = useRef(false);

    // Function to get mouth state based on audio intensity
    const getMouthState = (intensity: number): string => {
        if (intensity < 0.06) return MOUTH_STATES["10"];
        if (intensity < 0.10) return MOUTH_STATES["20"];
        if (intensity < 0.12) return MOUTH_STATES["30"];
        if (intensity < 0.20) return MOUTH_STATES["40"];
        return MOUTH_STATES["50"];
    };

    // Function to analyze audio and update mouth state
    const analyzeAudio = () => {
        if (!analyserRef.current) return;

        const dataArray = new Uint8Array(analyserRef.current.frequencyBinCount);
        analyserRef.current.getByteFrequencyData(dataArray);

        // Calculate average intensity
        const average = dataArray.reduce((acc, val) => acc + val, 0) / dataArray.length;
        const normalizedIntensity = average / 255;

        // Update mouth state based on intensity
        setCurrentMouthState(getMouthState(normalizedIntensity));

        // Continue animation loop
        setTimeout(analyzeAudio, 60);
    };

    useEffect(() => {
        const pollCharacters = () => {
            fetch(`${API_URL}/characters`)
                .then((res) => res.json())
                .then((data) => {
                    setCharacters(data.characters);
                    setTimeout(pollCharacters, 5000); // Poll every 5 seconds
                })
                .catch((error) => {
                    console.error("Error fetching characters:", error);
                    setTimeout(pollCharacters, 5000); // Retry after 5 seconds
                });
        };

        pollCharacters();

        return () => {
            if (animationFrameRef.current) {
                cancelAnimationFrame(animationFrameRef.current);
            }
        };
    }, []);

    useEffect(() => {
        socket.on("audio_segment", async (data) => {
            try {
                if (!audioContextRef.current || audioContextRef.current.state === "closed") {
                    audioContextRef.current = new (window.AudioContext || window.webkitAudioContext)();
                    analyserRef.current = audioContextRef.current.createAnalyser();
                    analyserRef.current.fftSize = 256;
                }

                // Convert base64 to ArrayBuffer correctly
                const base64 = data.audio.replace(/^data:audio\/\w+;base64,/, '');
                const binaryString = window.atob(base64);
                const bytes = new Uint8Array(binaryString.length);
                for (let i = 0; i < binaryString.length; i++) {
                    bytes[i] = binaryString.charCodeAt(i);
                }

                const audioBuffer = await audioContextRef.current.decodeAudioData(bytes.buffer);

                audioBufferQueue.current.push({
                    buffer: audioBuffer,
                    text: data.metadata.text,
                    character: data.metadata.character,
                });

                if (isPlaying && !isProcessingQueue.current) {
                    processQueue();
                }
            } catch (error) {
                console.error("Error processing audio segment:", error);
            }
        });

        return () => {
            socket.off("audio_segment");
        };
    }, [isPlaying]);

    const processQueue = async () => {
        if (!audioContextRef.current || audioBufferQueue.current.length === 0 || !isPlaying) {
            isProcessingQueue.current = false;
            return;
        }

        isProcessingQueue.current = true;
        const segment = audioBufferQueue.current[0];

        try {
            setCurrentText(segment.text);
            setCurrentCharacter(segment.character);

            const source = audioContextRef.current.createBufferSource();
            source.buffer = segment.buffer;

            // Connect source to analyzer
            source.connect(analyserRef.current!);
            // Connect analyzer to destination (speakers)
            analyserRef.current!.connect(audioContextRef.current.destination);

            if (currentSourceNode.current) {
                currentSourceNode.current.stop();
                currentSourceNode.current.disconnect();
            }

            currentSourceNode.current = source;

            // Start audio analysis
            analyzeAudio();

            await new Promise<void>((resolve) => {
                source.onended = () => {
                    audioBufferQueue.current.shift();
                    // Reset mouth state when audio ends
                    setCurrentMouthState(MOUTH_STATES["10"]);
                    resolve();
                };
                source.start(0);
            });

            processQueue();
        } catch (error) {
            console.error("Error playing audio:", error);
            isProcessingQueue.current = false;
        }
    };

    const handleStart = async () => {
        console.log("Start clicked");
        // Ensure audio context is initialized and resumed
        if (!audioContextRef.current) {
            audioContextRef.current = new (window.AudioContext || window.webkitAudioContext)();
            analyserRef.current = audioContextRef.current.createAnalyser();
            analyserRef.current.fftSize = 256;
        }
        await audioContextRef.current.resume();
        
        setIsPlaying(true);
        socket.emit("start_conversation");
    };

    const handlePlay = async () => {
        if (
            !audioContextRef.current ||
            audioContextRef.current.state === "closed"
        ) {
            audioContextRef.current = new (window.AudioContext ||
                window.webkitAudioContext)();
        }

        if (audioContextRef.current.state === "suspended") {
            await audioContextRef.current.resume();
        }

        setIsPlaying(true);
        if (!isProcessingQueue.current) {
            processQueue();
        }
    };

    const handlePause = () => {
        setIsPlaying(false);
        if (currentSourceNode.current) {
            currentSourceNode.current.stop();
        }
    };

    const handleStop = () => {
        setIsPlaying(false);
        isProcessingQueue.current = false;
        audioBufferQueue.current = [];
        if (currentSourceNode.current) {
            currentSourceNode.current.stop();
            currentSourceNode.current.disconnect();
        }
        setCurrentText("");
        setCurrentCharacter(null);
        socket.emit("stop_conversation");
    };

    // Add new useEffect for image preloading
    useEffect(() => {
        characters.forEach(character => {
            // Preload all mouth position images
            Object.values(character.mouth_positions).forEach(imageUrl => {
                const img = new Image();
                img.src = imageUrl;
            });
        });
    }, [characters]);

    return (
        <Sheet
            sx={{
                display: "flex",
                flexDirection: "column",
                height: "100vh",
                width: "100vw",
                background: 'linear-gradient(135deg, #1a1a1a 0%, #2d2d2d 100%)',
                padding: 0,
            }}
        >
            <Box sx={{
                display: "flex",
                flex: 1,
                width: "100%",
                justifyContent: "center",
                alignItems: "flex-start",
                padding: "2rem 4rem",
            }}>
                {characters.length === 0 ? (
                    <Box sx={{
                        display: "flex",
                        flexDirection: "column",
                        alignItems: "center",
                        justifyContent: "center",
                        gap: 2
                    }}>
                        <CircularProgress size="lg"/>
                        <Typography level="h3">Botcast loading soon...</Typography>
                    </Box>
                ) : (
                    <Box sx={{
                        width: "100%",
                        maxWidth: "1400px",
                        aspectRatio: "16/9",
                        position: "relative",
                        borderRadius: "16px",
                        overflow: "hidden",
                        margin: "0 auto",
                    }}>
                        <Sheet
                            variant="outlined"
                            sx={{
                                height: "100%",
                                width: "100%",
                                borderRadius: "16px",
                                overflow: "hidden",
                                border: "none",
                                backgroundImage: `url(${
                                    currentCharacter?.mouth_positions[currentMouthState] || 
                                    (characters[0]?.mouth_positions[MOUTH_STATES["10"]] || '')
                                })`,
                                backgroundSize: "100% auto",
                                backgroundPosition: "top center",
                                backgroundRepeat: "no-repeat",
                                backgroundColor: "#000",
                                boxShadow: "none",
                                transition: "background-image 0.1s ease-in-out",
                            }}
                        >
                            <Box
                                sx={{
                                    position: "absolute",
                                    bottom: 0,
                                    left: 0,
                                    right: 0,
                                    background: "linear-gradient(to top, rgba(0,0,0,0.95), rgba(0,0,0,0))",
                                    padding: "2rem 3rem",
                                    minHeight: "35%",
                                    display: "flex",
                                    flexDirection: "column",
                                    justifyContent: "flex-end",
                                }}
                            >
                                <Typography
                                    level="body-lg"
                                    sx={{
                                        color: "white",
                                        textShadow: "1px 1px 2px rgba(0,0,0,0.5)",
                                        fontSize: "1.2rem",
                                        lineHeight: 1.6,
                                    }}
                                >
                                    {currentText}
                                </Typography>
                            </Box>
                        </Sheet>
                    </Box>
                )}
            </Box>

            {/* Updated Controls */}
            <Sheet
                variant="outlined"
                sx={{
                    position: "fixed",
                    bottom: 0,
                    left: 0,
                    right: 0,
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    gap: 2,
                    p: 3,
                    borderRadius: 0,
                    borderWidth: 0,
                    borderTopWidth: 1,
                    backgroundColor: "rgba(0,0,0,0.8)",
                    backdropFilter: "blur(10px)",
                }}
            >
                <Box sx={{display: "flex", gap: 3}}>
                    <IconButton
                        variant="soft"
                        color={isPlaying ? "neutral" : "success"}
                        size="lg"
                        onClick={handleStart}
                        disabled={isPlaying}
                        sx={{
                            boxShadow: "0 4px 12px rgba(0,0,0,0.1)",
                            borderRadius: "12px",
                            p: 2,
                            '&:hover': {
                                transform: 'translateY(-2px)',
                                transition: 'transform 0.2s',
                            }
                        }}
                    >
                        <PowerSettingsNewIcon/>
                    </IconButton>

                    <IconButton
                        variant="soft"
                        color="primary"
                        size="lg"
                        onClick={isPlaying ? handlePause : handlePlay}
                        sx={{
                            boxShadow: "0 4px 12px rgba(0,0,0,0.1)",
                            borderRadius: "12px",
                            p: 2,
                            '&:hover': {
                                transform: 'translateY(-2px)',
                                transition: 'transform 0.2s',
                            }
                        }}
                    >
                        {isPlaying ? <PauseRoundedIcon/> : <PlayArrowRoundedIcon/>}
                    </IconButton>

                    <IconButton
                        variant="soft"
                        color="danger"
                        size="lg"
                        onClick={handleStop}
                        sx={{
                            boxShadow: "0 4px 12px rgba(0,0,0,0.1)",
                            borderRadius: "12px",
                            p: 2,
                            '&:hover': {
                                transform: 'translateY(-2px)',
                                transition: 'transform 0.2s',
                            }
                        }}
                    >
                        <StopRoundedIcon/>
                    </IconButton>
                </Box>

                <Box sx={{display: "flex", alignItems: "center", gap: 1}}>
                    <Typography 
                        level="body-lg" 
                        sx={{
                            color: "#666",
                            fontSize: "0.9rem",
                            fontWeight: 500,
                            letterSpacing: "0.05em",
                            display: "flex",
                            alignItems: "center",
                            "&::before": {
                                content: '""',
                                display: "inline-block",
                                width: "4px",
                                height: "4px",
                                borderRadius: "50%",
                                backgroundColor: "#666",
                                marginRight: "8px"
                            }
                        }}
                    >
                        POWERED BY ROLECHAIN
                    </Typography>
                </Box>
            </Sheet>
        </Sheet>
    );
}
