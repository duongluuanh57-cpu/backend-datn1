import { Product } from '../models/Product.ts';
import { generateEmbedding } from './ai/aiEmbedding.ts';

export interface VectorSearchResult {
  _id: string;
  name: string;
  price: number;
  description: string;
  brand: string;
  brandId: string;
  image?: string;
  variants: any[];
  rating: number;
  soldCount: number;
  vectorScore: number;
}

const VECTOR_INDEX = 'product_vector_index';

export class VectorSearchService {
  static async searchProducts(
    queryText: string,
    limit = 10
  ): Promise<VectorSearchResult[]> {
    const embedding = await generateEmbedding(queryText);

    const results = await Product.aggregate<VectorSearchResult>([
      {
        $vectorSearch: {
          index: VECTOR_INDEX,
          queryVector: embedding,
          path: 'embedding',
          numCandidates: Math.max(limit * 5, 30),
          limit,
        },
      },
      { $addFields: { vectorScore: { $meta: 'vectorSearchScore' } } },
      {
        $lookup: {
          from: 'brands',
          localField: 'brandId',
          foreignField: '_id',
          as: 'brandData',
        },
      },
      { $unwind: { path: '$brandData', preserveNullAndEmptyArrays: true } },
      {
        $project: {
          _id: 1,
          name: 1,
          price: 1,
          description: { $ifNull: ['$description', ''] },
          brand: '$brandData.name',
          brandId: 1,
          image: 1,
          variants: { $ifNull: ['$variants', []] },
          rating: { $ifNull: ['$rating', 0] },
          soldCount: { $ifNull: ['$soldCount', 0] },
          vectorScore: 1,
        },
      },
      { $sort: { vectorScore: -1 } },
    ]);

    return results;
  }

  static rrfMerge<T extends { _id: any }>(
    vectorResults: T[],
    keywordResults: T[],
    k = 60,
    limit = 4
  ): T[] {
    const scoreMap = new Map<string, number>();
    const docMap = new Map<string, T>();

    const updateScore = (docs: T[], startIndex: number) => {
      docs.forEach((doc, i) => {
        const id = doc._id.toString();
        scoreMap.set(id, (scoreMap.get(id) || 0) + 1 / (k + startIndex + i + 1));
        if (!docMap.has(id)) docMap.set(id, doc);
      });
    };

    updateScore(vectorResults, 0);
    updateScore(keywordResults, vectorResults.length);

    return [...scoreMap.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, limit)
      .map(([id]) => docMap.get(id)!);
  }
}