import { useState } from 'react';
import UploadPage from './UploadPage';
import PaintingPage from './PaintingPage';

export default function App() {
  const [mode, setMode] = useState('upload'); // 'upload' | 'painting'
  const [imageData, setImageData] = useState(null);
  const [image, setImage] = useState(null);

  if (mode === 'painting' && imageData) {
    return (
      <PaintingPage
        imageData={imageData}
        image={image}
        onBack={() => {
          setMode('upload');
          setImageData(null);
          setImage(null);
        }}
      />
    );
  }

  return (
    <UploadPage
      onAnalyze={(data, img) => {
        setImageData(data);
        setImage(img);
        setMode('painting');
      }}
    />
  );
}
