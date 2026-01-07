
from PIL import Image
import collections

try:
    img = Image.open(r'C:/Users/PEYALA ANANDA NAIDU/.gemini/antigravity/brain/4a64885d-7c26-44eb-be6e-1726621615db/uploaded_image_1767514924301.png')
    img = img.convert('RGB')
    pixels = list(img.getdata())
    # Filter out transparent or near-white/black if necessary, but logo extraction usually wants dominant colors.
    # We want the Blue and Orange.
    counts = collections.Counter(pixels)
    print("Top 20 colors:")
    for color, count in counts.most_common(20):
        print(f"Color: {color}, Count: {count}, Hex: #{color[0]:02x}{color[1]:02x}{color[2]:02x}")
except Exception as e:
    print(e)
