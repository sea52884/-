// Google Maps API 로드
const loadGoogleMaps = () => {
    const apiKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY;
    
    if (!apiKey) {
        console.error('Google Maps API Key is missing!');
        return;
    }
    
    // 이미 로드되었는지 확인
    if (window.google && window.google.maps) {
        return;
    }
    
    const script = document.createElement('script');
    script.src = `https://maps.googleapis.com/maps/api/js?key=${apiKey}&libraries=places`;
    script.async = true;
    script.defer = true;
    script.onload = () => {
        console.log('Google Maps loaded successfully');
    };
    script.onerror = () => {
        console.error('Failed to load Google Maps');
    };
    document.head.appendChild(script);
};

loadGoogleMaps();