'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { apiClient } from '../api/client'

interface League {
  id: number
  platform: string
  platform_league_id: string
  name: string
  league_type: string | null
  sync_status: string
  last_synced_at: string | null
}

export default function DashboardPage() {
  const router = useRouter()
  const [leagues, setLeagues] = useState<League[]>([])
  const [loading, setLoading] = useState(true)
  const [isConnectingYahoo, setIsConnectingYahoo] = useState(false)
  const [isConnectingESPN, setIsConnectingESPN] = useState(false)

  useEffect(() => {
    loadLeagues()
  }, [])

  const loadLeagues = async () => {
    try {
      const data = await apiClient.getLeagues()
      setLeagues(data)
    } catch (err) {
      console.error('Failed to load leagues:', err)
      // If unauthorized, redirect to login
      if (err instanceof Error && err.message.includes('401')) {
        router.push('/login')
      }
    } finally {
      setLoading(false)
    }
  }

  const handleConnectYahoo = async () => {
    setIsConnectingYahoo(true)
    try {
      await apiClient.authorizeYahoo()
    } catch (err) {
      console.error('Failed to connect Yahoo:', err)
      setIsConnectingYahoo(false)
    }
  }

  const handleConnectESPN = () => {
    setIsConnectingESPN(true)
    // TODO: Implement ESPN connection flow
    console.log('Connecting to ESPN...')
    setTimeout(() => setIsConnectingESPN(false), 2000)
  }

  const handleSyncLeague = async (leagueId: number) => {
    try {
      await apiClient.syncLeague(leagueId)
      // Reload leagues after sync
      await loadLeagues()
    } catch (err) {
      console.error('Failed to sync league:', err)
    }
  }

  if (loading) {
    return (
      <main className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 dark:from-gray-900 dark:to-gray-800 flex items-center justify-center">
        <div className="text-gray-600 dark:text-gray-300">Loading...</div>
      </main>
    )
  }

  return (
    <main className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 dark:from-gray-900 dark:to-gray-800 p-4">
      <div className="container mx-auto max-w-6xl py-8">
        <div className="flex justify-between items-center mb-8">
          <h1 className="text-4xl font-bold text-gray-900 dark:text-white">
            Dashboard
          </h1>
          <div className="flex gap-4">
            <Link
              href="/"
              className="text-gray-600 hover:text-gray-900 dark:text-gray-400 dark:hover:text-gray-200"
            >
              ← Back
            </Link>
            <button
              onClick={() => {
                localStorage.removeItem('access_token')
                router.push('/login')
              }}
              className="text-gray-600 hover:text-gray-900 dark:text-gray-400 dark:hover:text-gray-200"
            >
              Logout
            </button>
          </div>
        </div>

        <div className="bg-white dark:bg-gray-800 rounded-lg shadow-lg p-8 mb-8">
          <h2 className="text-2xl font-semibold mb-6 text-gray-900 dark:text-white">
            Connect Your League
          </h2>
          <p className="text-gray-600 dark:text-gray-300 mb-6">
            Connect your Yahoo or ESPN fantasy basketball league to start getting AI-powered streaming recommendations.
          </p>
          
          <div className="grid md:grid-cols-2 gap-4">
            <button
              onClick={handleConnectYahoo}
              disabled={isConnectingYahoo}
              className="bg-purple-600 hover:bg-purple-700 disabled:bg-purple-400 text-white font-semibold py-4 px-6 rounded-lg transition-colors flex items-center justify-center gap-2"
            >
              {isConnectingYahoo ? (
                <>
                  <span className="animate-spin">⏳</span>
                  Connecting...
                </>
              ) : (
                <>
                  <span>🏀</span>
                  Connect Yahoo League
                </>
              )}
            </button>
            
            <button
              onClick={handleConnectESPN}
              disabled={isConnectingESPN}
              className="bg-red-600 hover:bg-red-700 disabled:bg-red-400 text-white font-semibold py-4 px-6 rounded-lg transition-colors flex items-center justify-center gap-2"
            >
              {isConnectingESPN ? (
                <>
                  <span className="animate-spin">⏳</span>
                  Connecting...
                </>
              ) : (
                <>
                  <span>🏀</span>
                  Connect ESPN League
                </>
              )}
            </button>
          </div>
        </div>

        {leagues.length === 0 ? (
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-lg p-8 text-center">
            <p className="text-gray-600 dark:text-gray-300 mb-4">
              No leagues connected yet. Connect a league above to get started.
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            {leagues.map((league) => (
              <div
                key={league.id}
                className="bg-white dark:bg-gray-800 rounded-lg shadow-lg p-6"
              >
                <div className="flex justify-between items-start">
                  <div>
                    <h3 className="text-xl font-semibold text-gray-900 dark:text-white mb-2">
                      {league.name}
                    </h3>
                    <p className="text-gray-600 dark:text-gray-300">
                      {league.platform.toUpperCase()} • {league.league_type || 'Category'} • Status: {league.sync_status}
                    </p>
                    {league.last_synced_at && (
                      <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                        Last synced: {new Date(league.last_synced_at).toLocaleString()}
                      </p>
                    )}
                  </div>
                  <button
                    onClick={() => handleSyncLeague(league.id)}
                    className="bg-blue-600 hover:bg-blue-700 text-white font-semibold py-2 px-4 rounded-lg transition-colors"
                  >
                    Sync Now
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </main>
  )
}
