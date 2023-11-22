import { Box, Paper, Modal, Typography, Divider, Button, Drawer, useTheme } from '@mui/material'
import { InspectorProvider } from '../context/Inspector'
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { useApi } from './api'
import {
    Schemas,
    type Message,
    type Stream,
    type CommonstreamSchema,
    type DomainProfileSchema
} from '@concurrent-world/client'
import { Draft } from '../components/Draft'
import { useLocation } from 'react-router-dom'
import { usePreference } from './PreferenceContext'
import { ProfileEditor } from '../components/ProfileEditor'
import { MessageContainer } from '../components/Message/MessageContainer'
import { Menu } from '../components/Menu/Menu'
import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3'
import { fileToBase64 } from '../util'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'

export interface GlobalActionsState {
    openDraft: () => void
    openReply: (target: Message<any>) => void
    openReroute: (target: Message<any>) => void
    openMobileMenu: (open?: boolean) => void
    allKnownStreams: Array<Stream<CommonstreamSchema>>
    uploadFile: (file: File) => Promise<string | null>
    isUploadReady: boolean
}

const GlobalActionsContext = createContext<GlobalActionsState | undefined>(undefined)

interface GlobalActionsProps {
    children: JSX.Element | JSX.Element[]
}

const style = {
    position: 'absolute',
    top: '30%',
    left: '50%',
    transform: 'translate(-50%, -50%)',
    width: '700px',
    maxWidth: '90vw'
}

export const GlobalActionsProvider = (props: GlobalActionsProps): JSX.Element => {
    const client = useApi()
    const pref = usePreference()
    const path = useLocation()
    const theme = useTheme()
    const [mode, setMode] = useState<'compose' | 'reply' | 'reroute' | 'none'>('none')
    const [targetMessage, setTargetMessage] = useState<Message<any> | null>(null)

    const [queriedStreams, setQueriedStreams] = useState<Array<Stream<CommonstreamSchema>>>([])
    const [allKnownStreams, setAllKnownStreams] = useState<Array<Stream<CommonstreamSchema>>>([])
    const [domainIsOffline, setDomainIsOffline] = useState<boolean>(false)
    const [mobileMenuOpen, setMobileMenuOpen] = useState<boolean>(false)

    const setupAccountRequired =
        client?.user !== null &&
        (client?.user.profile === undefined ||
            client?.user.userstreams === undefined ||
            !client?.user.userstreams.payload.body.homeStream ||
            !client?.user.userstreams.payload.body.notificationStream ||
            !client?.user.userstreams.payload.body.associationStream ||
            !client?.user.userstreams.payload.body.ackCollection)

    useEffect(() => {
        const allStreams = Object.values(pref.lists)
            .map((list) => list.streams)
            .flat()
        const uniq = [...new Set(allStreams)]
        uniq.forEach((id) => {
            client.getStream<CommonstreamSchema>(id).then((stream) => {
                if (stream) {
                    setAllKnownStreams((prev) => [...prev, stream])
                }
            })
        })
    }, [pref.lists])

    useEffect(() => {
        client.api.readDomain(client.api.host).then((domain) => {
            if (domain === null) {
                setDomainIsOffline(true)
            }
        })
    }, [client.user])

    const openDraft = useCallback(() => {
        let streamIDs: string[] = []
        switch (path.pathname) {
            case '/stream': {
                streamIDs = path.hash.replace('#', '').split(',')
                break
            }
            default: {
                const rawid = path.hash.replace('#', '')
                const list = pref.lists[rawid] ?? Object.values(pref.lists)[0]
                if (!list) break
                streamIDs = list.defaultPostStreams
                break
            }
        }

        Promise.all(streamIDs.map((id) => client.getStream(id))).then((streams) => {
            setQueriedStreams(streams.filter((e) => e !== null) as Array<Stream<CommonstreamSchema>>)
        })

        setMode('compose')
    }, [path.pathname, path.hash, pref.lists])

    const openReply = useCallback((target: Message<any>) => {
        setTargetMessage(target)
        setMode('reply')
    }, [])

    const openReroute = useCallback(
        (target: Message<any>) => {
            setTargetMessage(target)
            setMode('reroute')
        },
        [setTargetMessage, setMode]
    )

    const openMobileMenu = useCallback((open?: boolean) => {
        setMobileMenuOpen(open ?? true)
    }, [])

    const handleKeyPress = useCallback(
        (event: KeyboardEvent) => {
            if (document.activeElement?.tagName === 'INPUT' || document.activeElement?.tagName === 'TEXTAREA') {
                return
            }
            switch (event.key) {
                case 'n':
                    setTimeout(() => {
                        // XXX: this is a hack to prevent the keypress from being captured by the draft
                        openDraft()
                    }, 0)
                    break
            }
        },
        [openDraft]
    )

    const fixAccount = useCallback(async () => {
        console.log('starting account fix')
        await client.setupUserstreams()
        console.log('userstream setup complete')
        const domain = await client.api.readDomain(client.api.host)
        if (!domain) throw new Error('Domain not found')
        try {
            const domainProfile = await client.api.readCharacter<DomainProfileSchema>(
                domain.ccid,
                Schemas.domainProfile
            )
            if (!domainProfile) throw new Error('Domain profile not found')
            if (domainProfile.payload.body.defaultBookmarkStreams)
                localStorage.setItem(
                    'bookmarkingStreams',
                    JSON.stringify(domainProfile.payload.body.defaultBookmarkStreams)
                )
            if (domainProfile.payload.body.defaultFollowingStreams)
                localStorage.setItem(
                    'followingStreams',
                    JSON.stringify(domainProfile.payload.body.defaultFollowingStreams)
                )
            if (domainProfile.payload.body.defaultPostStreams)
                localStorage.setItem('postingStreams', JSON.stringify(domainProfile.payload.body.defaultPostStreams))
        } catch (e) {
            console.info(e)
        }
        window.location.reload()
    }, [client])

    useEffect(() => {
        // attach the event listener
        document.addEventListener('keydown', handleKeyPress)

        // remove the event listener
        return () => {
            document.removeEventListener('keydown', handleKeyPress)
        }
    }, [handleKeyPress])

    const s3Client = useMemo(() => {
        if (pref.storageProvider !== 's3') return null
        return new S3Client({
            endpoint: pref.s3Config.endpoint,
            credentials: {
                accessKeyId: pref.s3Config.accessKeyId,
                secretAccessKey: pref.s3Config.secretAccessKey
            },
            region: 'auto',
            forcePathStyle: pref.s3Config.forcePathStyle
        })
    }, [pref.storageProvider, pref.s3Config])

    const uploadFile = useCallback(
        async (file: File) => {
            const base64Data = await fileToBase64(file)
            if (!base64Data) return null

            if (pref.storageProvider === 's3') {
                if (!s3Client) return null
                const _base64Data = base64Data.split(',')[1]
                const byteCharacters = atob(_base64Data)
                const byteNumbers = new Array(byteCharacters.length)
                for (let i = 0; i < byteCharacters.length; i++) {
                    byteNumbers[i] = byteCharacters.charCodeAt(i)
                }
                const byteArray = new Uint8Array(byteNumbers)

                const fileName = `${Date.now()}`
                const url = await getSignedUrl(
                    s3Client,
                    new PutObjectCommand({
                        Bucket: pref.s3Config.bucketName,
                        Key: fileName
                    }),
                    {
                        expiresIn: 60 // 1 minute
                    }
                )
                try {
                    const result = await fetch(url, {
                        method: 'PUT',
                        headers: {
                            'Content-Type': file.type,
                            'Content-Encoding': 'base64',
                            'x-amz-acl': 'public-read',
                            'Content-Disposition': 'inline'
                        },
                        body: byteArray
                    })
                    if (!result.ok) {
                        return null
                    }
                    return `${pref.s3Config.publicUrl}/${fileName}`
                } catch (e) {
                    return null
                }
            } else if (pref.storageProvider === 'imgur') {
                const url = 'https://api.imgur.com/3/image'
                if (!pref.imgurClientID) return ''
                const isImage = file.type.includes('image')
                if (!isImage) return null

                const result = await fetch(url, {
                    method: 'POST',
                    headers: {
                        Authorization: `Client-ID ${pref.imgurClientID}`,
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        type: 'base64',
                        image: base64Data.replace(/^data:image\/[a-zA-Z]*;base64,/, '')
                    })
                })
                return (await result.json()).data.link
            } else if (pref.storageProvider === 'domain') {
                const isImage = file.type.includes('image')
                if (!isImage) return null

                const result = await client.api.fetchWithCredential(client.host, '/storage/files', {
                    method: 'POST',
                    headers: {
                        'Content-Type': file.type
                    },
                    body: file
                })

                if (!result.ok) {
                    console.error('upload failed:', result)
                    return null
                }

                const json = await result.json()

                return json.content.url
            }
            return null
        },
        [pref.storageProvider, pref.imgurClientID, pref.s3Config]
    )

    const isUploadReady = useMemo(() => {
        if (pref.storageProvider === 's3') {
            return !!pref.s3Config.endpoint
        } else if (pref.storageProvider === 'imgur') {
            return !!pref.imgurClientID
        } else if (pref.storageProvider === 'domain') {
            return 'mediaserver' in client.domainServices
        }
        return false
    }, [pref.storageProvider, pref.imgurClientID, s3Client])

    return (
        <GlobalActionsContext.Provider
            value={useMemo(() => {
                return {
                    openDraft,
                    openReply,
                    openReroute,
                    openMobileMenu,
                    allKnownStreams,
                    uploadFile,
                    isUploadReady
                }
            }, [openDraft, openReply, openReroute, openMobileMenu, allKnownStreams, uploadFile, isUploadReady])}
        >
            <InspectorProvider>
                <>{props.children}</>
                <Modal
                    open={mode !== 'none'}
                    onClose={() => {
                        setMode('none')
                    }}
                >
                    <>
                        {mode === 'compose' && (
                            <Paper sx={style}>
                                <Box sx={{ display: 'flex' }}>
                                    <Draft
                                        autoFocus
                                        streamPickerInitial={queriedStreams}
                                        streamPickerOptions={allKnownStreams}
                                        onSubmit={async (text: string, destinations: string[], options) => {
                                            await client
                                                .createCurrent(text, destinations, options)
                                                .catch((e) => {
                                                    return e
                                                })
                                                .finally(() => {
                                                    setMode('none')
                                                })
                                            return null
                                        }}
                                        sx={{
                                            p: 1
                                        }}
                                    />
                                </Box>
                            </Paper>
                        )}
                        {targetMessage && (mode === 'reply' || mode === 'reroute') && (
                            <Paper sx={style}>
                                <MessageContainer messageID={targetMessage.id} messageOwner={targetMessage.author} />
                                <Divider />
                                <Box sx={{ display: 'flex' }}>
                                    <Draft
                                        autoFocus
                                        allowEmpty={mode === 'reroute'}
                                        submitButtonLabel={mode === 'reply' ? 'Reply' : 'Reroute'}
                                        streamPickerInitial={targetMessage.postedStreams ?? []}
                                        streamPickerOptions={
                                            mode === 'reroute' ? allKnownStreams : targetMessage.postedStreams ?? []
                                        }
                                        onSubmit={async (text, streams, options): Promise<Error | null> => {
                                            if (mode === 'reroute') {
                                                await targetMessage.reroute(streams, text, options?.emojis)
                                            } else if (mode === 'reply') {
                                                await targetMessage.reply(streams, text, options?.emojis)
                                            }
                                            setMode('none')
                                            return null
                                        }}
                                        sx={{
                                            p: 1
                                        }}
                                    />
                                </Box>
                            </Paper>
                        )}
                    </>
                </Modal>
                <Modal open={domainIsOffline} onClose={() => {}}>
                    <Paper sx={style}>
                        <Box
                            sx={{
                                display: 'flex',
                                flexDirection: 'column'
                            }}
                        >
                            <Typography>
                                あなたのドメイン{client.api.host}は現在オフラインです。復旧までしばらくお待ちください。
                            </Typography>
                            <Button
                                variant="contained"
                                onClick={() => {
                                    window.location.reload()
                                }}
                            >
                                Reload
                            </Button>
                        </Box>
                    </Paper>
                </Modal>
                <Modal open={setupAccountRequired} onClose={() => {}}>
                    <Paper sx={style}>
                        <Box
                            sx={{
                                display: 'flex',
                                flexDirection: 'column'
                            }}
                        >
                            <Typography variant="h2" component="div">
                                アカウント設定を完了させましょう！
                            </Typography>
                            見つかった問題:
                            <ul>
                                {!client?.user?.profile && <li>プロフィールが存在していません</li>}
                                {!client?.user?.userstreams?.payload.body.homeStream && (
                                    <li>ホームストリームが存在していません</li>
                                )}
                                {!client?.user?.userstreams?.payload.body.notificationStream && (
                                    <li>通知ストリームが存在していません</li>
                                )}
                                {!client?.user?.userstreams?.payload.body.associationStream && (
                                    <li>アクティビティストリームが存在していません</li>
                                )}
                                {!client?.user?.userstreams?.payload.body.ackCollection && (
                                    <li>Ackコレクションが存在していません</li>
                                )}
                            </ul>
                            <ProfileEditor
                                id={client?.user?.profile?.id}
                                initial={client?.user?.profile?.payload.body}
                                onSubmit={(_) => {
                                    fixAccount()
                                }}
                            />
                        </Box>
                    </Paper>
                </Modal>
                <Drawer
                    anchor={'left'}
                    open={mobileMenuOpen}
                    onClose={() => {
                        setMobileMenuOpen(false)
                    }}
                    PaperProps={{
                        sx: {
                            width: '200px',
                            pt: 1,
                            borderRadius: `0 ${theme.shape.borderRadius * 2}px ${theme.shape.borderRadius * 2}px 0`,
                            overflow: 'hidden',
                            backgroundColor: 'background.default'
                        }
                    }}
                >
                    <Menu
                        onClick={() => {
                            setMobileMenuOpen(false)
                        }}
                    />
                </Drawer>
            </InspectorProvider>
        </GlobalActionsContext.Provider>
    )
}

export function useGlobalActions(): GlobalActionsState {
    return useContext(GlobalActionsContext) as GlobalActionsState
}
