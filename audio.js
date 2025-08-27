// audio.js

// A simple state machine for our music playback
const MusicState = {
    STOPPED: 'stopped',
    DELAYED_START: 'delayed_start',
    FADING_IN: 'fading_in',
    PLAYING: 'playing',
    FADING_OUT: 'fading_out', // For future use, e.g., changing tracks
    COOLDOWN: 'cooldown',
};

export class AudioManager {
    constructor(camera) {
        this.listener = new THREE.AudioListener();
        camera.add(this.listener);

        this.loader = new THREE.AudioLoader();
        this.sounds = new Map();
        this.isUnlocked = false;

        // --- NEW MUSIC PROPERTIES ---
        this.music = null;
        this.musicPlaylist = [];
        this.currentTrackIndex = 0;
        this.musicVolume = 0.3; // The target volume
        this.musicState = MusicState.STOPPED;

        // Fading properties
        this.fadeDuration = 0;
        this.fadeTimer = 0;
        this.fadeStartVolume = 0;
        this.fadeTargetVolume = 0;

        // Timer properties
        this.musicTimeoutId = null;
    }

    /**
     * Unlocks the browser's audio context. Must be called after the first user interaction.
     */
    unlockAudio() {
        if (this.isUnlocked) return;
        
        const context = this.listener.context;
        if (context.state === 'suspended') {
            context.resume();
        }
        this.isUnlocked = true;
        console.log('Audio context unlocked.');

        // If music was loaded, start the timed playback cycle.
        if (this.music && this.musicState === MusicState.STOPPED) {
            this.startMusicCycle();
        }
    }

    /**
     * Called every frame from the main game loop to handle fades.
     * @param {number} deltaTime - Time since the last frame.
     */
    update(deltaTime) {
        if (this.musicState === MusicState.FADING_IN || this.musicState === MusicState.FADING_OUT) {
            this.fadeTimer += deltaTime;
            const progress = Math.min(this.fadeTimer / this.fadeDuration, 1.0);
            
            // Linear interpolation (lerp) for volume
            const newVolume = this.fadeStartVolume + (this.fadeTargetVolume - this.fadeStartVolume) * progress;
            this.music.setVolume(newVolume);

            if (progress >= 1.0) {
                // Fade complete
                if (this.musicState === MusicState.FADING_IN) {
                    this.musicState = MusicState.PLAYING;
                } else if (this.musicState === MusicState.FADING_OUT) {
                    this.musicState = MusicState.STOPPED;
                    this.music.stop();
                }
            }
        }
    }

    async loadSounds(soundList) {
        const promises = [];
        for (const [name, path] of Object.entries(soundList)) {
            const promise = new Promise((resolve, reject) => {
                this.loader.load(path, (buffer) => {
                    this.sounds.set(name, buffer);
                    console.log(`Loaded sound: ${name}`);
                    resolve();
                }, undefined, reject);
            });
            promises.push(promise);
        }
        await Promise.all(promises);
        console.log('All sound effects loaded.');
    }

    /**
     * Loads a playlist of music. Does not play immediately.
     * @param {string[]} playlist - An array of paths to music files.
     * @param {number} [volume=0.3] - The target volume for the music.
     */
    loadMusicPlaylist(playlist, volume = 0.3) {
        this.musicPlaylist = playlist;
        this.musicVolume = volume;
        if (this.musicPlaylist.length === 0) return;

        this.loader.load(this.musicPlaylist[this.currentTrackIndex], (buffer) => {
            if (this.music) {
                this.music.stop();
            }
            this.music = new THREE.Audio(this.listener);
            this.music.setBuffer(buffer);
            this.music.setLoop(false); // We handle looping manually with cooldown
            this.music.setVolume(0); // Start at 0 volume

            // When the track finishes, trigger the cooldown period
            this.music.onEnded = () => {
                console.log('Music track finished. Starting cooldown.');
                this.musicState = MusicState.COOLDOWN;
                this.startCooldown();
            };
        });
    }

    /**
     * Kicks off the initial 20-second delay for the music.
     */
    startMusicCycle() {
        if (!this.music || this.musicState !== MusicState.STOPPED) return;

        console.log('Music cycle started. Waiting 20 seconds...');
        this.musicState = MusicState.DELAYED_START;
        this.musicTimeoutId = setTimeout(() => {
            this.fadeInMusic(5.0); // Fade in over 5 seconds
        }, 20000); // 20 seconds
    }

    /**
     * Starts the fade-in process for the current music track.
     * @param {number} duration - How long the fade-in should take in seconds.
     */
    fadeInMusic(duration) {
        if (!this.music) return;
        
        console.log(`Fading in music over ${duration}s.`);
        this.fadeDuration = duration;
        this.fadeTimer = 0;
        this.fadeStartVolume = 0;
        this.fadeTargetVolume = this.musicVolume;
        this.musicState = MusicState.FADING_IN;
        
        if (!this.music.isPlaying) {
            this.music.play();
        }
    }

    /**
     * Starts the cooldown period after a track finishes.
     */
    startCooldown() {
        // Random cooldown between 2 and 5 minutes (120,000 to 300,000 ms)
        const cooldownTime = 120000 + Math.random() * 180000;
        console.log(`Music cooldown: ${Math.round(cooldownTime / 1000)} seconds.`);
        
        this.musicTimeoutId = setTimeout(() => {
            // Optional: Load the next track in the playlist
            // this.currentTrackIndex = (this.currentTrackIndex + 1) % this.musicPlaylist.length;
            // For now, we'll just replay the same track after loading it again.
            this.loadMusicPlaylist(this.musicPlaylist, this.musicVolume);
            
            // Wait a moment for the track to load before fading in
            setTimeout(() => this.fadeInMusic(5.0), 500);

        }, cooldownTime);
    }

    playSound(name, volume = 0.5) {
        if (!this.isUnlocked || !this.sounds.has(name)) return;

        const sound = new THREE.Audio(this.listener);
        sound.setBuffer(this.sounds.get(name));
        sound.setVolume(volume);
        sound.play();
    }

    /**
     * Cleans up any active timers to prevent memory leaks.
     */
    cleanup() {
        if (this.musicTimeoutId) {
            clearTimeout(this.musicTimeoutId);
            console.log('Cleared active music timer.');
        }
    }
}