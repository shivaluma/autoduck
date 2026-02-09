import { GoogleGenerativeAI } from '@google/generative-ai'

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || '')

/**
 * Generate live commentary from a race screenshot
 */
export async function generateCommentary(screenshotBase64: string): Promise<string> {
  try {
    const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' })

    const result = await model.generateContent([
      {
        inlineData: {
          mimeType: 'image/jpeg',
          data: screenshotBase64,
        },
      },
      {
        text: `Bạn là một bình luận viên thể thao điện tử hài hước và hơi xéo sắc. 
Đây là hình ảnh một cuộc đua vịt đang diễn ra. 
Hãy đưa ra MỘT câu bình luận ngắn (dưới 30 từ, bằng tiếng Việt) về tình hình cuộc đua, 
tập trung vào các chú vịt đang dẫn đầu hoặc đang bị tụt lại phía sau một cách ngớ ngẩn. 
Không mô tả chung chung, hãy nhắc đến vị trí cụ thể nếu thấy tên vịt.
Chỉ trả về câu bình luận, không thêm gì khác.`,
      },
    ])

    return result.response.text().trim()
  } catch (error) {
    console.error('AI Commentary error:', error)
    return 'Cuộc đua đang diễn ra sôi nổi!'
  }
}

/**
 * Extract ranking from the final results screenshot using AI Vision
 */
export async function extractRanking(
  screenshotBase64: string
): Promise<{ rank: number; name: string }[]> {
  try {
    const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' })

    const result = await model.generateContent([
      {
        inlineData: {
          mimeType: 'image/jpeg',
          data: screenshotBase64,
        },
      },
      {
        text: `Nhiệm vụ của bạn là trích xuất bảng xếp hạng từ hình ảnh này.
Đây là kết quả cuộc đua vịt (duck race). 
Hãy trả về kết quả ĐÚNG theo định dạng JSON sau, không thêm bất kỳ văn bản nào khác:
[{"rank": 1, "name": "Tên Vịt A"}, {"rank": 2, "name": "Tên Vịt B"}, ...]
Danh sách phải được sắp xếp theo thứ tự rank từ 1 đến cuối.
Đảm bảo tên được trích xuất chính xác.
CHỈ trả về JSON array, không markdown, không giải thích.`,
      },
    ])

    const text = result.response.text().trim()
    // Clean up potential markdown code blocks
    const cleanJson = text.replace(/```json?\n?/g, '').replace(/```/g, '').trim()
    return JSON.parse(cleanJson)
  } catch (error) {
    console.error('AI Ranking extraction error:', error)
    throw new Error('Failed to extract ranking from screenshot')
  }
}
