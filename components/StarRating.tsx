import React from 'react';

interface StarRatingProps {
    rating: number; // 0-5 (0 means no rating)
    onRatingChange: (rating: number) => void;
    size?: 'sm' | 'md' | 'lg';
}

const StarRating: React.FC<StarRatingProps> = ({ rating, onRatingChange, size = 'md' }) => {
    const sizeClasses = {
        sm: 'w-3 h-3',
        md: 'w-4 h-4',
        lg: 'w-5 h-5'
    };

    const handleStarClick = (starValue: number, e: React.MouseEvent) => {
        e.stopPropagation(); // Prevent triggering parent click
        // If clicking the same star as the current rating, toggle it off (set to 0)
        const newRating = starValue === rating ? 0 : starValue;
        onRatingChange(newRating);
    };

    const handleStarHover = (starValue: number) => {
        // Optional: Add hover effect
    };

    return (
        <div className="flex items-center gap-0.5" onClick={(e) => e.stopPropagation()}>
            {[1, 2, 3, 4, 5].map((starValue) => (
                <button
                    key={starValue}
                    type="button"
                    onClick={(e) => handleStarClick(starValue, e)}
                    onMouseEnter={() => handleStarHover(starValue)}
                    className={`${sizeClasses[size]} transition-all duration-150 hover:scale-110 focus:outline-none`}
                    title={`Rate ${starValue} star${starValue > 1 ? 's' : ''}`}
                >
                    {starValue <= rating ? (
                        // Filled star
                        <svg
                            className="w-full h-full text-yellow-400 fill-current"
                            viewBox="0 0 20 20"
                            fill="currentColor"
                        >
                            <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
                        </svg>
                    ) : (
                        // Empty star (outline)
                        <svg
                            className="w-full h-full text-slate-500 hover:text-yellow-400/50 transition-colors"
                            viewBox="0 0 20 20"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth={1.5}
                        >
                            <path
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z"
                            />
                        </svg>
                    )}
                </button>
            ))}
        </div>
    );
};

export default StarRating;

