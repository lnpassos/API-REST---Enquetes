
import { FastifyInstance } from "fastify"
import { prisma } from "../../lib/prisma"
import { z } from "zod"
import { randomUUID } from "node:crypto"
import { redis } from "../../lib/redis"
import { voting } from "../utils/voting-pub-sub"

export async function voteOnPoll(app: FastifyInstance) {

    app.post('/polls/:pollId/votes', async (request, reply) => {

        const voteOnPollBody = z.object({
            pollOptionId: z.string().uuid()
        })

        const voteOnPollParams = z.object({

            pollId: z.string().uuid(),
        })
    
        const { pollId } = voteOnPollParams.parse(request.params)
        const { pollOptionId } = voteOnPollBody.parse(request.body)

        let { sessionId } = request.cookies

        if (sessionId) {
            const userPreviousVoteOnPoll = await prisma.vote.findUnique({
                
                where: {
                    sessionId_pollId: {
                        sessionId,
                        pollId,
                    }
                }
            })

            // Deleta voto do usuário caso ele ja tenha votado e queira mudar seu voto.
            if(userPreviousVoteOnPoll && userPreviousVoteOnPoll.pollOptionId != pollOptionId) {  
                
                await prisma.vote.delete({
                    where: {
                        id: userPreviousVoteOnPoll.id,
                    }
                })

                // Quando deletar o voto, abaixar score no Redis
                await redis.zincrby(pollId, -1, userPreviousVoteOnPoll.pollOptionId)

            }

            // Caso tenha votado e esteja querendo votar novamente.
            else if (userPreviousVoteOnPoll) {
                return reply.status(400).send({message: "Você ja efetou seu voto nessa enquete!"})
            }
        }

        if (!sessionId) {

            sessionId = randomUUID()

            reply.setCookie('sessionId', sessionId, {
               path: '/',
               maxAge: 60 * 60 * 24 * 30,
               signed: true,
               httpOnly: true,
            })
        }

        await prisma.vote.create({
            data: {
                sessionId,
                pollId,
                pollOptionId,
            }
        })
            

        const votes = await redis.zincrby(pollId, 1, pollOptionId)

        return reply.status(201).send()

        voting.publish(pollId, {
            pollOptionId,
            votes: Number(votes)
        })
    })

}